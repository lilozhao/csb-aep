/**
 * GDI 观测存储（GdiStore）· CSB-AEP v2.3
 *
 * 域隔离（红线第 6 条）：观测记录写 data/gdi/gdi-store.json（独立于评测 results）。
 * 分级：
 *   L1 —— 观测摘要（dimensions 数值 + present 卡片）：本人 + 人类席位可查（MVP 无鉴权，记录 requester）
 *   L3 —— 善意自评原文（M2 引入）：默认不落盘明文
 * 存储：JSON 文件 append（保留历史 → 趋势箭头自第二观测期起生效）
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data', 'gdi');
const STORE_FILE = path.join(DATA_DIR, 'gdi-store.json');

class GdiStore {
  constructor(file = STORE_FILE) {
    this.file = file;
    this.data = { observations: [] };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      }
    } catch (e) {
      console.warn('[GdiStore] 读取失败，使用空数据:', e.message);
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.warn('[GdiStore] 写入失败:', e.message);
    }
  }

  /** 存入一次观测（L1 摘要；requester 留痕；自评分数不落盘——L3 敏感） */
  saveObservation(obs) {
    const record = {
      agent: obs.agent,
      observedAt: obs.observedAt,
      requester: obs.requester || 'anonymous',
      dimensions: obs.dimensions,
      calibration: obs.calibration || null,
      present: obs.present,
      slices: obs.slices || [],
    };
    this.data.observations.push(record);
    this.save();
    return record;
  }

  /** 某 agent 最近一次观测 */
  latest(agent) {
    const list = this.data.observations.filter(o => o.agent === agent);
    return list.length ? list[list.length - 1] : null;
  }

  /** 某 agent 观测历史（趋势用，按时间升序） */
  history(agent) {
    return this.data.observations.filter(o => o.agent === agent);
  }
}

module.exports = { GdiStore };
