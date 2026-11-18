// 客户端静态配置: 与服务端 server/common/config/*.lua 保持一致
// 修改数值/作物时两端都要改(后续可改成服务器下发 S2CConfig)
(function (global) {
    'use strict';

    const CROPS = {
        1: { id: 1, name: '小麦', seed_item: 1001, fruit_item: 1101, grow_seconds: 45, yield_min: 3, yield_max: 5, exp: 6, color: '#e8c14a' },
        2: { id: 2, name: '番茄', seed_item: 1002, fruit_item: 1102, grow_seconds: 90, yield_min: 4, yield_max: 6, exp: 12, color: '#e05b4d' },
        3: { id: 3, name: '胡萝卜', seed_item: 1003, fruit_item: 1103, grow_seconds: 20, yield_min: 2, yield_max: 4, exp: 4, color: '#e8873a' },
        4: { id: 4, name: '草莓', seed_item: 1004, fruit_item: 1104, grow_seconds: 150, yield_min: 3, yield_max: 5, exp: 20, color: '#e0415f' },
    };

    const ITEMS = {
        1001: { id: 1001, name: '小麦种子', kind: 'seed', crop_id: 1, buy_price: 10, sell_price: 0, icon: '🌾' },
        1002: { id: 1002, name: '番茄种子', kind: 'seed', crop_id: 2, buy_price: 25, sell_price: 0, icon: '🍅' },
        1003: { id: 1003, name: '胡萝卜种子', kind: 'seed', crop_id: 3, buy_price: 6, sell_price: 0, icon: '🥕' },
        1004: { id: 1004, name: '草莓种子', kind: 'seed', crop_id: 4, buy_price: 50, sell_price: 0, icon: '🍓' },
        1101: { id: 1101, name: '小麦', kind: 'fruit', crop_id: 1, buy_price: 0, sell_price: 4, icon: '🌾' },
        1102: { id: 1102, name: '番茄', kind: 'fruit', crop_id: 2, buy_price: 0, sell_price: 10, icon: '🍅' },
        1103: { id: 1103, name: '胡萝卜', kind: 'fruit', crop_id: 3, buy_price: 0, sell_price: 3, icon: '🥕' },
        1104: { id: 1104, name: '草莓', kind: 'fruit', crop_id: 4, buy_price: 0, sell_price: 20, icon: '🍓' },
        2001: { id: 2001, name: '化肥', kind: 'tool', buy_price: 20, sell_price: 5, icon: '🧪' },
    };

    const CONST = {
        plot_count: 12,
        unlocked_plots: 6,
        level_base_exp: 100,
        level_step_exp: 50,
    };

    global.FarmCfg = { CROPS, ITEMS, CONST };
})(globalThis);