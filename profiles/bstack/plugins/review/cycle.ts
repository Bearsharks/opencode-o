import { createHash } from 'node:crypto';

export const lanes = ['product', 'function'] as const;
export type Lane = typeof lanes[number];
export type Row = { definition: string; verification: string; grounds: { definition: string; verification: string } };
export type Table = Record<Lane, Row>;
export type Vote = { status: 'PASS'|'RESOLVE'|'BLOCKED'; report: string; reviewer: string; head: string; scope: string };
export type Cycle = { sessions: Partial<Record<Lane,string>>; votes: Partial<Record<Lane,Vote>>; repairs: string[]; head: string; revision: number; request: string; paused?: boolean };
export const fresh = ():Cycle => ({sessions:{},votes:{},repairs:[],head:'',revision:0,request:''});
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function identity(table: Table, requests: string[], evidence: string, supporting: unknown = []) {
  const row = (r: Row) => [r.definition,r.verification,r.grounds.definition,r.grounds.verification];
  // A receipt from the old, single-rationale rubric cannot authorize the current review.
  const scope = (lane: Lane) => digest(['PRD/1',supporting,requests,evidence,lane,row(table[lane]),table.product.definition,table.function.definition]);
  return {head:digest(['PRD/1',supporting,requests,evidence,row(table.product),row(table.function)]), scopes:{product:scope('product'),function:scope('function')}};
}
export function parseReport(text:string, head:string, lane:Lane) {
  const match = /^VERDICT: (PASS|RESOLVE|BLOCKED) ([a-f0-9]{64}) (product|function)\r?\n\s*(\S[\s\S]*)$/.exec(text.trim());
  if(!match || match[2]!==head || match[3]!==lane) throw Error('UNCONFIRMED: stale or malformed reviewer response');
  if(match[1]==='PASS' && (!/^D:[^\S\r\n]*\S[^\r\n]*$/m.test(match[4]) || !/^V:[^\S\r\n]*\S[^\r\n]*$/m.test(match[4])))
    throw Error('UNCONFIRMED: PASS requires separate definition and verification rationales');
  return match[1] as Vote['status'];
}
export function conclude(c:Cycle) {
  const votes=lanes.map(k=>c.votes[k]);
  if(votes.some(v=>!v)) throw Error('UNCONFIRMED: missing reviewer');
  if(votes.some(v=>v!.status==='BLOCKED')) return 'BLOCKED';
  if(votes.some(v=>v!.status==='RESOLVE')) {
    if(!c.repairs.includes(c.head)) c.repairs.push(c.head);
    if(c.repairs.length>=4) { c.paused=true; return 'AWAITING_USER'; }
    return 'RESOLVE';
  }
  return 'PASS';
}
