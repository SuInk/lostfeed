// 在 Node 里模拟 Shadowrocket 的脚本环境跑 lostfeed.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'lostfeed.js'), 'utf8');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const store = {};

function run(ctx) {
  let result;
  const sandbox = Object.assign({
    console,
    $argument: 'max=800',
    $persistentStore: {
      read: k => (k in store ? store[k] : null),
      write: (v, k) => { store[k] = v; return true; },
    },
    $done: r => { result = r; },
  }, ctx);
  vm.runInNewContext(code, sandbox);
  return result;
}

const respond = (url, body) => run({ $request: { url }, $response: { status: 200, body } });

// 推特
let r = respond('https://api.x.com/graphql/abc/HomeTimeline?variables=x', fixture('twitter-home.json'));
assert.strictEqual(JSON.stringify(r), '{}', '响应应原样放行');
const tw = JSON.parse(store['lostfeed.twitter']);
assert.deepStrictEqual(tw.map(t => t.id), ['1001', '1003', '1004'], '顺序正确且跳过广告');
assert.strictEqual(tw[0].handle, 'alice');
assert.strictEqual(tw[0].images[0], 'https://pbs.twimg.com/media/a.jpg');
assert.strictEqual(tw[1].text, 'long note text');
assert.strictEqual(tw[1].rtBy, 'Bob');
assert.strictEqual(tw[1].url, 'https://x.com/carol/status/1003');

// 重复刷到不重复记录
respond('https://api.x.com/graphql/abc/HomeTimeline', fixture('twitter-home.json'));
assert.strictEqual(JSON.parse(store['lostfeed.twitter']).length, 3);

// 小红书
respond('https://edith.xiaohongshu.com/api/sns/v6/homefeed?oid=homefeed_recommend', fixture('xhs-homefeed.json'));
respond('https://edith.xiaohongshu.com/api/sns/v10/search/notes?keyword=x', fixture('xhs-search.json'));
const xhs = JSON.parse(store['lostfeed.xhs']);
assert.deepStrictEqual(xhs.map(n => n.id.slice(-1)), ['4', '1', '3'], '跳过广告，新的在前');
const coffee = xhs.find(n => n.id.endsWith('1'));
assert.strictEqual(coffee.title, '周末咖啡店');
assert.strictEqual(coffee.url, 'https://www.xiaohongshu.com/explore/650000000000000000000001?xsec_token=abc%3D');
assert.strictEqual(xhs.find(n => n.id.endsWith('3')).isVideo, true);

// 坏数据不影响放行
assert.strictEqual(JSON.stringify(respond('https://api.x.com/graphql/abc/HomeTimeline', 'not json')), '{}');

// 查看页面
r = run({ $request: { url: 'http://feed.history/' } });
assert.strictEqual(r.response.status, 200);
assert.ok(r.response.body.includes('周末咖啡店'));
assert.ok(!r.response.body.includes('hello <world>'), '内容中的 < 应被转义');
fs.writeFileSync(path.join(__dirname, 'preview.html'), r.response.body);

r = run({ $request: { url: 'http://feed.history/api/export?p=xhs' } });
assert.deepStrictEqual(Object.keys(JSON.parse(r.response.body)), ['xhs']);

r = run({ $request: { url: 'http://feed.history/api/clear?p=twitter' } });
assert.strictEqual(store['lostfeed.twitter'], '[]');
assert.strictEqual(JSON.parse(store['lostfeed.xhs']).length, 3);

// 上限
store['lostfeed.twitter'] = '[]';
run({ $argument: 'max=2', $request: { url: 'https://api.x.com/graphql/a/HomeTimeline' }, $response: { body: fixture('twitter-home.json') } });
assert.strictEqual(JSON.parse(store['lostfeed.twitter']).length, 2);

console.log('all tests passed');
