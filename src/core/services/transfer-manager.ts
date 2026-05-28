/**
 * Central transfer queue. Single files go through the connection pool
 * (low latency); folders go through rclone. Progress and lifecycle are
 * emitted on the EventBus and mirrored into transfer_history.
 */
import { statSync } from "node:fs";
import type {
  Connection,
  Project,
  TransferJob,
  TransferKind,
} from "../../shared/domain";
import type { ConnectionPool } from "../connections/pool";
import type { RcloneClient } from "../rclone/client";
import type { HistoryRepo } from "../db/repositories";
import type { EventBus } from "../events";

interface QueuedTask {
  job: TransferJob;
  run: () => Promise<void>;
}

export class TransferManager {
  private jobs = new Map<string, TransferJob>();
  private queue: QueuedTask[] = [];
  private active = 0;
  private cancelled = new Set<string>();
  private rcloneJobByJobId = new Map<string, number>();
  private seq = 0;

  constructor(
    private pool: ConnectionPool,
    private rclone: RcloneClient,
    private history: HistoryRepo,
    private bus: EventBus,
    private concurrency = 3,
  ) {}

  list(): TransferJob[] {
    return [...this.jobs.values()];
  }

  private newJob(
    conn: Connection,
    project: Project | null,
    kind: TransferKind,
    label: string,
  ): TransferJob {
    const job: TransferJob = {
      id: `job-${++this.seq}-${this.seq}`,
      projectId: project?.id ?? null,
      connectionId: conn.id,
      kind,
      label,
      status: "queued",
      progress: 0,
      bytesDone: 0,
      bytesTotal: 0,
      speed: 0,
      filesDone: 0,
      filesTotal: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    this.emit(job);
    return job;
  }

  private emit(job: TransferJob): void {
    this.bus.emit("transfer:update", { ...job });
  }

  private finish(job: TransferJob, status: TransferJob["status"], error: string | null): void {
    job.status = status;
    job.error = error;
    job.finishedAt = new Date().toISOString();
    if (status === "done") job.progress = 1;
    this.emit(job);
    this.bus.emit("transfer:done", { ...job });
    this.history.add({
      projectId: job.projectId,
      kind: job.kind,
      path: job.label,
      status,
      bytes: job.bytesDone,
      startedAt: job.startedAt ?? job.finishedAt,
      finishedAt: job.finishedAt,
      error,
    });
  }

  /* ----------------------------- enqueue -------------------------------- */

  enqueueUpload(conn: Connection, localPath: string, remotePath: string): TransferJob {
    const job = this.newJob(conn, null, "upload", `Upload ${localPath}`);
    try {
      job.bytesTotal = statSync(localPath).size;
      job.filesTotal = 1;
    } catch {
      /* size unknown */
    }
    this.schedule({
      job,
      run: () =>
        this.pool.withTransport(conn, (t) =>
          t.upload(localPath, remotePath, (bytes) => {
            job.bytesDone = bytes;
            job.progress = job.bytesTotal ? bytes / job.bytesTotal : 0;
            this.emit(job);
          }),
        ),
    });
    return job;
  }

  enqueueDownload(conn: Connection, remotePath: string, localPath: string): TransferJob {
    const job = this.newJob(conn, null, "download", `Download ${remotePath}`);
    job.filesTotal = 1;
    this.schedule({
      job,
      run: () =>
        this.pool.withTransport(conn, async (t) => {
          const st = await t.stat(remotePath);
          job.bytesTotal = st?.size ?? 0;
          await t.download(remotePath, localPath, (bytes) => {
            job.bytesDone = bytes;
            job.progress = job.bytesTotal ? bytes / job.bytesTotal : 0;
            this.emit(job);
          });
        }),
    });
    return job;
  }

  enqueueUploadFolder(
    conn: Connection,
    localDir: string,
    remoteDir: string,
    filters: string[] = [],
  ): TransferJob {
    const job = this.newJob(conn, null, "upload-folder", `Upload folder ${localDir}`);
    this.schedule({
      job,
      run: () =>
        this.runRclone(job, async () => {
          await this.rclone.ensureDaemon();
          const dstFs = await this.rclone.buildFs(conn, remoteDir);
          return this.rclone.startSync({
            srcFs: localDir,
            dstFs,
            mode: "copy",
            filters,
            extra: { createEmptySrcDirs: true },
          });
        }),
    });
    return job;
  }

  enqueueDownloadFolder(
    conn: Connection,
    remoteDir: string,
    localDir: string,
    filters: string[] = [],
  ): TransferJob {
    const job = this.newJob(conn, null, "download-folder", `Download folder ${remoteDir}`);
    this.schedule({
      job,
      run: () =>
        this.runRclone(job, async () => {
          await this.rclone.ensureDaemon();
          const srcFs = await this.rclone.buildFs(conn, remoteDir);
          return this.rclone.startSync({
            srcFs,
            dstFs: localDir,
            mode: "copy",
            filters,
            extra: { createEmptySrcDirs: true },
          });
        }),
    });
    return job;
  }

  /** Enqueue a sync job whose rclone job id is produced by `start`. */
  enqueueSync(
    conn: Connection,
    direction: "up" | "down" | "both",
    label: string,
    start: () => Promise<number>,
    projectId: number | null = null,
  ): TransferJob {
    const kind: TransferKind =
      direction === "up" ? "sync-up" : direction === "down" ? "sync-down" : "sync-both";
    const job = this.newJob(conn, null, kind, label);
    job.projectId = projectId;
    this.schedule({ job, run: () => this.runRclone(job, start) });
    return job;
  }

  /** Drive an rclone job to completion, mirroring stats into the job. */
  private async runRclone(
    job: TransferJob,
    start: () => Promise<number>,
  ): Promise<void> {
    const rcloneJobId = await start();
    this.rcloneJobByJobId.set(job.id, rcloneJobId);
    while (true) {
      if (this.cancelled.has(job.id)) {
        await this.rclone.stopJob(rcloneJobId).catch(() => {});
        throw new Error("cancelled");
      }
      const [status, stats] = await Promise.all([
        this.rclone.jobStatus(rcloneJobId),
        this.rclone.jobStats(rcloneJobId).catch(() => null),
      ]);
      if (stats) {
        job.bytesDone = stats.bytes;
        job.bytesTotal = stats.totalBytes;
        job.speed = stats.speed;
        job.filesDone = stats.transfers;
        job.filesTotal = stats.totalTransfers;
        job.progress = stats.totalBytes ? stats.bytes / stats.totalBytes : 0;
        this.emit(job);
      }
      if (status.finished) {
        if (!status.success) throw new Error(status.error || "rclone job failed");
        return;
      }
      await Bun.sleep(400);
    }
  }

  /* ----------------------------- scheduling ----------------------------- */

  private schedule(task: QueuedTask): void {
    this.queue.push(task);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      if (this.cancelled.has(task.job.id)) {
        this.finish(task.job, "cancelled", null);
        continue;
      }
      this.active++;
      task.job.status = "running";
      task.job.startedAt = new Date().toISOString();
      this.emit(task.job);
      task
        .run()
        .then(() => this.finish(task.job, "done", null))
        .catch((err: Error) =>
          this.finish(
            task.job,
            err.message === "cancelled" ? "cancelled" : "error",
            err.message === "cancelled" ? null : err.message,
          ),
        )
        .finally(() => {
          this.active--;
          this.cancelled.delete(task.job.id);
          this.rcloneJobByJobId.delete(task.job.id);
          this.pump();
        });
    }
  }

  cancel(jobId: string): void {
    this.cancelled.add(jobId);
    const rcloneJobId = this.rcloneJobByJobId.get(jobId);
    if (rcloneJobId !== undefined) this.rclone.stopJob(rcloneJobId).catch(() => {});
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
        this.jobs.delete(id);
      }
    }
  }
}
