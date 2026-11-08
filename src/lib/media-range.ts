// Range 处理：上游 CDN 有些会忽略 Range、直接回整包 200。
// 播放器每次拖动都从 0 字节重新下载的话，长视频必然卡死，
// 所以这里自己把请求的那一段切出来，回标准的 206。

export type RangeSpec = { start: number; end: number | null };

/** 只解析单段 Range（播放器、下载管理器都只用单段）。 */
export function parseRange(range: string | null): RangeSpec | null {
  if (!range) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!m) return null;
  const [, s, e] = m;
  // bytes=-500（取末尾 N 字节）需要总长才切得出来，交给上游处理
  if (s === "") return null;
  const start = Number(s);
  const end = e === "" ? null : Number(e);
  if (!Number.isFinite(start) || start < 0) return null;
  if (end !== null && (!Number.isFinite(end) || end < start)) return null;
  return { start, end };
}

/** 从上游整包流里切出 [start, end] 这一段。end 为 null 表示到结尾。 */
export function sliceStream(
  body: ReadableStream<Uint8Array> | null,
  start: number,
  end: number | null,
): ReadableStream<Uint8Array> {
  if (!body) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  }
  const reader = body.getReader();
  let skipped = 0;
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (!value || value.length === 0) continue;
        let chunk: Uint8Array = value;
        if (skipped < start) {
          const need = start - skipped;
          if (chunk.length <= need) {
            skipped += chunk.length;
            continue;
          }
          chunk = chunk.subarray(need);
          skipped = start;
        }
        if (end !== null) {
          const remain = end - start + 1 - sent;
          if (remain <= 0) {
            controller.close();
            void reader.cancel().catch(() => {});
            return;
          }
          if (chunk.length > remain) chunk = chunk.subarray(0, remain);
        }
        sent += chunk.length;
        controller.enqueue(chunk);
        return;
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {});
    },
  });
}
