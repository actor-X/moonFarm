(function (global) {
    'use strict';

    // ============================================================
    // 网络层: 浏览器 WebSocket
    // 服务器没有请求序号 —— 响应就是"等某个 S2C 消息"
    // ============================================================
    class Net {
        constructor() {
            this.ws = null;
            this.connected = false;
            this.handlers = new Map();   // 消息名 -> fn(data, msg)
            this.waiters = new Map();    // 消息名 -> [{ resolve, reject }]
            this.closeHandler = null;
        }

        connect(url) {
            return new Promise((resolve, reject) => {
                if (this.connected) return resolve(this);
                const ws = new WebSocket(url);
                ws.binaryType = 'arraybuffer';
                ws.onopen = () => {
                    this.connected = true;
                    this.ws = ws;
                    resolve(this);
                };
                ws.onerror = () => {
                    if (!this.connected) reject(new Error('连接失败: ' + url));
                };
                ws.onclose = () => {
                    this.connected = false;
                    this._failAllWaiters('连接已断开');
                    if (this.closeHandler) this.closeHandler();
                };
                ws.onmessage = (e) => this._dispatch(e.data);
            });
        }

        send(name, obj) {
            if (!this.connected) throw new Error('尚未连接服务器');
            this.ws.send(Protocol.pack(name, obj));
        }

        // 发送并等待某个响应消息; 业务错误码自动变成 {ok:false}
        call(name, obj, expect) {
            const names = Array.isArray(expect) ? expect : [expect];
            const p = this._waitFor(names, true);
            this.send(name, obj);
            return p;
        }

        on(name, fn) {
            this.handlers.set(name, fn);
        }

        onClose(fn) {
            this.closeHandler = fn;
        }

        close() {
            if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } }
            this.connected = false;
        }

        // ---------- 内部 ----------

        _dispatch(buf) {
            let msg;
            try {
                msg = Protocol.unpack(new Uint8Array(buf));
            } catch (err) {
                console.error('[net] 消息解码失败:', err);
                return;
            }
            const w = this.waiters.get(msg.name);
            if (w && w.length) {
                const item = w.shift();
                if (!w.length) this.waiters.delete(msg.name);
                item.resolve(msg);
                return;
            }
            const h = this.handlers.get(msg.name);
            if (h) h(msg.data, msg);
        }

        _waitFor(names, rejectOnError) {
            names = names.slice();
            if (rejectOnError && !names.includes('S2CErrorCode')) names.push('S2CErrorCode');
            const self = this;
            return new Promise((resolve, reject) => {
                const entries = [];
                let settled = false;
                const settle = (fn, arg) => {
                    if (settled) return;
                    settled = true;
                    for (const [n, item] of entries) {
                        const arr = self.waiters.get(n);
                        if (arr) {
                            const i = arr.indexOf(item);
                            if (i >= 0) arr.splice(i, 1);
                            if (!arr.length) self.waiters.delete(n);
                        }
                    }
                    fn(arg);
                };
                for (const n of names) {
                    if (!self.waiters.has(n)) self.waiters.set(n, []);
                    const isErr = n === 'S2CErrorCode';
                    const item = {
                        resolve: (v) => settle(resolve, {
                            ok: !isErr,
                            name: v.name,
                            data: v.data,
                        }),
                        reject: (e) => settle(reject, e),
                    };
                    self.waiters.get(n).push(item);
                    entries.push([n, item]);
                }
            });
        }

        _failAllWaiters(reason) {
            for (const [, arr] of this.waiters) {
                for (const item of arr) item.reject(new Error(reason));
            }
            this.waiters.clear();
        }
    }

    global.Net = Net;
})(globalThis);