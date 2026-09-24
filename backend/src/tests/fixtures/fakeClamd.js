/**
 * S-04 — an in-process TCP server that speaks clamd's protocol as clamd(8)
 * documents it, strictly enough that a client which does not frame INSTREAM
 * gets the error a real clamd would give it.
 *
 * Commands understood, with the `z` (NUL-terminated) or `n` (newline-
 * terminated) prefix: PING, INSTREAM. Anything else is answered with
 * `UNKNOWN COMMAND` and the connection is closed, as clamd does.
 *
 * INSTREAM: a sequence of chunks, each `<uint32 big-endian length><bytes>`,
 * ended by a zero-length chunk. A chunk whose declared length would push the
 * stream past `streamMaxLength` is answered `INSTREAM size limit exceeded.
 * ERROR` and the connection closed. A completed stream that begins with the
 * EICAR test string answers `stream: Eicar-Test-Signature FOUND`, anything
 * else `stream: OK`.
 *
 * `mode` overrides the behaviour for failure tests:
 *  - "normal"          the protocol above
 *  - "hang"            accept, read, never answer
 *  - "close"           close the connection as soon as anything arrives
 *  - { reply: "..." }  answer the first bytes received with this text (plus
 *                      NUL) and close — e.g. "UNKNOWN COMMAND"
 *
 * Every connection is recorded in `sessions` (command, chunk sizes, payload),
 * so a test can assert WHAT was sent, not only what came back.
 */
const net = require("net");

const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * @param {object} [opts]
 * @param {number} [opts.streamMaxLength=26214400] - clamd's StreamMaxLength (25 MB default)
 * @param {string} [opts.path] - listen on this Unix socket / named pipe instead of TCP
 * @returns {Promise<{port: number, sessions: object[], setMode: Function, close: Function}>}
 */
async function startFakeClamd({ streamMaxLength = 25 * 1024 * 1024, path } = {}) {
  let mode = "normal";
  const sessions = [];
  const sockets = new Set();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});

    const session = { command: null, chunkSizes: [], payload: null, reply: null };
    sessions.push(session);
    const currentMode = mode;
    let buf = Buffer.alloc(0);
    let done = false;
    const payload = [];
    let total = 0;

    const answer = (text, terminator) => {
      if (done) {return;}
      done = true;
      session.reply = text;
      socket.end(Buffer.from(`${text}${terminator}`, "latin1"));
    };

    socket.on("data", (data) => {
      if (done) {return;}
      if (currentMode === "hang") {return;}
      if (currentMode === "close") {
        done = true;
        socket.destroy();
        return;
      }
      if (currentMode && typeof currentMode === "object" && "reply" in currentMode) {
        if (currentMode.split) {
          // The reply in two TCP segments: the client must keep reading
          // until the NUL rather than parse the first packet.
          done = true;
          session.reply = currentMode.reply;
          const half = Math.floor(currentMode.reply.length / 2);
          socket.write(currentMode.reply.slice(0, half), "latin1");
          setTimeout(() => socket.end(`${currentMode.reply.slice(half)}\0`, "latin1"), 30);
          return;
        }
        answer(currentMode.reply, "\0");
        return;
      }

      buf = Buffer.concat([buf, data]);

      if (session.command === null) {
        const first = buf[0];
        const term = first === 0x7a /* z */ ? 0x00 : first === 0x6e /* n */ ? 0x0a : null;
        const end = term === null ? buf.indexOf(0x0a) : buf.indexOf(term);
        if (end === -1) {return;}
        const raw = buf.subarray(0, end).toString("latin1");
        buf = buf.subarray(end + 1);
        session.command = raw;
        const name = term === null ? raw.replace(/\r$/, "") : raw.slice(1);
        session.terminator = term === 0x00 ? "\0" : "\n";
        if (name === "PING") {
          answer("PONG", session.terminator);
          return;
        }
        if (name !== "INSTREAM") {
          answer("UNKNOWN COMMAND", "\n");
          return;
        }
      }

      // INSTREAM chunks
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const content = Buffer.concat(payload);
          session.payload = content;
          answer(
            content.toString("latin1").startsWith(EICAR)
              ? "stream: Eicar-Test-Signature FOUND"
              : "stream: OK",
            session.terminator,
          );
          return;
        }
        if (total + len > streamMaxLength) {
          answer("INSTREAM size limit exceeded. ERROR", session.terminator);
          return;
        }
        if (buf.length < 4 + len) {return;}
        session.chunkSizes.push(len);
        payload.push(buf.subarray(4, 4 + len));
        total += len;
        buf = buf.subarray(4 + len);
      }
    });
  });

  await new Promise((resolve) =>
    path ? server.listen(path, resolve) : server.listen(0, "127.0.0.1", resolve),
  );

  return {
    port: path ? null : server.address().port,
    sessions,
    setMode: (m) => {
      mode = m;
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) {s.destroy();}
        server.close(() => resolve());
      }),
  };
}

module.exports = { startFakeClamd, EICAR };
