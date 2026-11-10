// MongoDB store (set MONGO_URL). Same interface as fileStore.
// Note: one run is one document (16 MB limit ≈ 15k FC-days with insights); use the file store beyond that.
import mongoose from 'mongoose';
import { CFG } from '../config.js';

const Mixed = mongoose.Schema.Types.Mixed;
const Run = mongoose.model('Run', new mongoose.Schema({ createdAt: { type: Date, default: Date.now }, updatedAt: Date, status: String, progress: Mixed, meta: Mixed, result: Mixed, error: Mixed, delivery: Mixed }, { minimize: false }));
const Memory = mongoose.model('MemoryDay', new mongoose.Schema({ fc: { type: String, index: true }, date: String, data: Mixed }).index({ fc: 1, date: 1 }, { unique: true }));
const Override = mongoose.model('Override', new mongoose.Schema({ createdAt: { type: Date, default: Date.now }, fc: String, date: String, line: String, type: String, note: String, until: String }));

const toRun = (d) => d && { id: String(d._id), createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt?.toISOString(), status: d.status, progress: d.progress, meta: d.meta, result: d.result ?? null, error: d.error ?? null, delivery: d.delivery ?? null };

export const mongoStore = {
  kind: 'mongodb',
  async init() { await mongoose.connect(CFG.MONGO_URL, { serverSelectionTimeoutMS: 5000 }); },
  async createRun(meta) { return toRun((await Run.create({ status: 'queued', progress: { step: 'queued', pct: 0 }, meta })).toObject()); },
  async updateRun(id, patch) { return toRun(await Run.findByIdAndUpdate(id, { ...patch, updatedAt: new Date() }, { new: true }).lean()); },
  async getRun(id) { return mongoose.isValidObjectId(id) ? toRun(await Run.findById(id).lean()) : null; },
  async listRuns() {
    const docs = await Run.find({}, { result: 0 }).sort({ createdAt: -1 }).limit(50).lean();
    const sums = await Run.find({ _id: { $in: docs.map((d) => d._id) } }, { 'result.summary.totals': 1, 'result.summary.lastDate': 1, 'result.summary.fcs.fc': 1 }).lean();
    const byId = Object.fromEntries(sums.map((s) => [String(s._id), s.result?.summary]));
    return docs.map((d) => { const s = byId[String(d._id)]; return { ...toRun(d), result: undefined, summary: s ? { totals: s.totals, fcs: s.fcs?.length, lastDate: s.lastDate } : null, delivery: d.delivery?.summary || null }; });
  },
  async getMemory(fcs) {
    const out = Object.fromEntries(fcs.map((f) => [f, {}]));
    for (const m of await Memory.find({ fc: { $in: fcs } }).lean()) out[m.fc][m.date] = m.data;
    return out;
  },
  async upsertMemory(days) {
    if (!days.length) return;
    await Memory.bulkWrite(days.map((d) => ({ updateOne: { filter: { fc: d.fc, date: d.date }, update: { $set: { data: { revenue: d.revenue, costs: d.costs, status: d.status, zeroLines: d.zeroLines || [] } } }, upsert: true } })));
  },
  async clearMemory() { await Memory.deleteMany({}); },
  async listOverrides() { return (await Override.find().lean()).map((o) => ({ ...o, id: String(o._id), _id: undefined, createdAt: o.createdAt.toISOString() })); },
  async addOverride(o) { const d = await Override.create(o); return { ...d.toObject(), id: String(d._id) }; },
  async deleteOverride(id) { return mongoose.isValidObjectId(id) && (await Override.deleteOne({ _id: id })).deletedCount > 0; },
};
