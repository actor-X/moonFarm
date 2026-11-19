(function (global) {
    'use strict';

    // 单次请求超时(ms). 超时后从等待队列移除并以 reject 结束, 避免 UI 永久卡住.
    const CALL_TIMEOUT = 5000;

    // ============================================================
    // 网络层: 浏览器 WebSocket
    // 服务器没有请求序号 —— 响应就是"等某个 S2C 消息"
    // 当前用"S2COk.cmd 过滤 + 操作队列串行"来对应请求;
    // 真正的并发(同一操作多次在飞)需要服务端回显 seq.
    // ============================================================
    class Net {
        constructor() {
            this.ws = null;
            this.connected = false;
            this.handlers = new Map();   // 消息名 -> fn(data, msg)
            this.waiters = new Map();    // 消息名 -> [{ match, resolve, cancel, timer }]
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

        // 发送并等待响应; 业务错误码自动变成 {ok:false}
        // @param opts.timeout 覆盖默认超时(ms)
        call(name, obj, expect, opts) {
            const names = Array.isArray(expect) ? expect : [expect];
            const timeout = (opts && opts.timeout) || CALL_TIMEOUT;
            // S2COk 带 cmd 字段, 用它过滤掉其他操作的确认包
            const CmdCode = (global.Protocol && global.Protocol.CmdCode) || {};
            const cmd = CmdCode[name];
            const p = this._waitFor(names, { timeout, cmd });
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

            // 找第一个匹配的等待者; S2COk 只认本次请求的 cmd
            const arr = this.waiters.get(msg.name);
            if (arr && arr.length) {
                for (let i = 0; i < arr.length; i++) {
                    const item = arr[i];
                    if (item.match && !item.match(msg)) continue;
                    arr.splice(i, 1);
                    if (!arr.length) this.waiters.delete(msg.name);
                    item.resolve(msg);
                    return;
                }
            }

            // 没有等待者(例如超时后迟到的响应)就交给推送 handler; 没有 handler 则忽略
            const h = this.handlers.get(msg.name);
            if (h) h(msg.data, msg);
        }

        _waitFor(names, opts) {
            const self = this;
            const timeout = opts.timeout;
            const cmd = opts.cmd;

            return new Promise((resolve, reject) => {
                const entries = [];
                let settled = false;
                let timer = null;

                const removeEntries = () => {
                    for (let k = 0; k < entries.length; k++) {
                        const n = entries[k][0];
                        const item = entries[k][1];
                        const list = self.waiters.get(n);
                        if (!list) continue;
                        const i = list.indexOf(item);
                        if (i >= 0) list.splice(i, 1);
                        if (!list.length) self.waiters.delete(n);
                    }
                };

                const settle = (fn, arg) => {
                    if (settled) return;
                    settled = true;
                    if (timer) { clearTimeout(timer); timer = null; }
                    removeEntries();
                    fn(arg);
                };

                // 除 S2COk 外都接受; S2COk 必须 cmd 对应本次请求
                const accept = (msg) => {
                    if (msg.name !== 'S2COk') return true;
                    if (cmd === undefined) return true;
                    return !!msg.data && msg.data.cmd === cmd;
                };

                const allNames = names.slice();
                if (!allNames.includes('S2CErrorCode')) allNames.push('S2CErrorCode');

                for (const n of allNames) {
                    const isErr = n === 'S2CErrorCode';
                    const item = {
                        timer: null,
                        match: (msg) => isErr || accept(msg),
                        resolve: (v) => settle(resolve, {
                            ok: !isErr,
                            name: v.name,
                            data: v.data,
                        }),
                        cancel: (err) => settle(reject, err),
                    };
                    if (!self.waiters.has(n)) self.waiters.set(n, []);
                    self.waiters.get(n).push(item);
                    entries.push([n, item]);
                }

                timer = setTimeout(() => {
                    settle(reject, new Error('请求超时'));
                }, timeout);

                for (const entry of entries) entry[1].timer = timer;
            });
        }

        _failAllWaiters(reason) {
            const pending = [];
            for (const [, arr] of this.waiters) {
                for (const item of arr) pending.push(item);
            }
            this.waiters.clear();
            for (const item of pending) {
                item.cancel(new Error(reason));
            }
        }
    }

    global.Net = Net;
})(globalThis);