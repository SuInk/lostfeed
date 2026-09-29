/**
 * LostFeed — Shadowrocket (小火箭) 脚本
 *
 * 1. http-response：拦截推特 / 小红书的信息流接口，把刷到的内容存进 $persistentStore
 * 2. http-request：访问 http://feed.history 时返回一个本地查看页面
 *
 * 响应永远原样放行，解析出错也不会影响 App 正常使用。
 */

const STORE_KEYS = {
  twitter: 'lostfeed.twitter',
  xhs: 'lostfeed.xhs',
};
const PLATFORM_NAMES = { twitter: '推特', xhs: '小红书' };
const DEFAULT_MAX = 800;
const ICON_URL = 'https://raw.githubusercontent.com/SuInk/lostfeed/main/icon.png';
const VIEWER_RE = /^https?:\/\/feed\.history(?:[\/?#]|$)/;

// ---------- 通用工具 ----------

function parseArgs(raw) {
  const out = {};
  if (typeof raw !== 'string') return out;
  raw.split('&').forEach(pair => {
    const i = pair.indexOf('=');
    if (i > 0) out[decodeURIComponent(pair.slice(0, i).trim())] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

function maxItems() {
  const args = parseArgs(typeof $argument !== 'undefined' ? $argument : '');
  const n = parseInt(args.max, 10);
  return n > 0 ? n : DEFAULT_MAX;
}

function walk(node, visit, depth) {
  depth = depth || 0;
  if (!node || typeof node !== 'object' || depth > 60) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, depth + 1);
    return;
  }
  if (visit(node) === false) return; // false = 不再深入这个节点
  for (const k in node) walk(node[k], visit, depth + 1);
}

function queryOf(url) {
  const q = {};
  const i = url.indexOf('?');
  if (i < 0) return q;
  url.slice(i + 1).split('#')[0].split('&').forEach(pair => {
    const j = pair.indexOf('=');
    const k = decodeURIComponent(j < 0 ? pair : pair.slice(0, j));
    q[k] = j < 0 ? '' : decodeURIComponent(pair.slice(j + 1).replace(/\+/g, ' '));
  });
  return q;
}

function pathOf(url) {
  return url.replace(/^https?:\/\/[^\/]+/, '').split('?')[0].split('#')[0] || '/';
}

// ---------- 推特解析 ----------

function twitterEndpoint(url) {
  const m = url.match(/\/graphql\/[^\/]+\/(\w+)/);
  return m ? m[1] : 'unknown';
}

function normTweet(r, endpoint) {
  if (!r) return null;
  if (r.__typename === 'TweetWithVisibilityResults' && r.tweet) r = r.tweet;
  const legacy = r.legacy;
  if (!legacy) return null;

  const user = r.core && r.core.user_results && r.core.user_results.result;
  const handle = user && ((user.core && user.core.screen_name) || (user.legacy && user.legacy.screen_name)) || '';
  const name = user && ((user.core && user.core.name) || (user.legacy && user.legacy.name)) || handle;

  // 转推：记录原推，并标明是谁转的
  const rt = legacy.retweeted_status_result && legacy.retweeted_status_result.result;
  if (rt) {
    const inner = normTweet(rt, endpoint);
    if (inner) {
      inner.rtBy = name || handle;
      return inner;
    }
  }

  const id = r.rest_id || legacy.id_str;
  if (!id) return null;
  const note = r.note_tweet && r.note_tweet.note_tweet_results && r.note_tweet.note_tweet_results.result;
  const media = ((legacy.extended_entities && legacy.extended_entities.media) || [])
    .map(m => m.media_url_https)
    .filter(Boolean)
    .slice(0, 4);

  return {
    id: String(id),
    author: name,
    handle: handle,
    text: (note && note.text) || legacy.full_text || '',
    images: media,
    createdAt: Date.parse(legacy.created_at) || 0,
    url: 'https://x.com/' + (handle || 'i/web') + '/status/' + id,
    source: endpoint,
  };
}

function extractTwitter(json, url) {
  const endpoint = twitterEndpoint(url);
  const out = [];
  walk(json, node => {
    const res = node.tweet_results && node.tweet_results.result;
    if (!res) return;
    if (node.promotedMetadata) return false; // 广告
    const t = normTweet(res, endpoint);
    if (t) out.push(t);
    return false;
  });
  return out;
}

// ---------- 小红书解析 ----------

function xhsEndpoint(url) {
  const m = url.match(/\/api\/sns\/v\d+\/([\w\/]+)/);
  return m ? m[1] : 'unknown';
}

function isXhsNote(node) {
  if (typeof node.id !== 'string' || !/^[0-9a-f]{24}$/.test(node.id)) return false;
  if (!(node.user || node.author)) return false;
  return 'title' in node || 'display_title' in node || 'desc' in node;
}

function xhsImage(node) {
  const list = node.images_list || node.image_list || [];
  const urls = list.map(i => i && (i.url_size_large || i.url || i.original)).filter(Boolean);
  if (!urls.length && node.cover) urls.push(node.cover.url || node.cover.url_default);
  return urls.filter(Boolean).slice(0, 4);
}

function extractXhs(json, url) {
  const endpoint = xhsEndpoint(url);
  const out = [];
  walk(json, node => {
    if (node.model_type === 'ads' || node.is_ads || node.ads_info) return false; // 广告
    if (!isXhsNote(node)) return;
    const user = node.user || node.author || {};
    const token = node.xsec_token ? '?xsec_token=' + encodeURIComponent(node.xsec_token) : '';
    out.push({
      id: node.id,
      author: user.nickname || user.name || '',
      handle: user.userid || user.user_id || user.id || '',
      title: node.display_title || node.title || '',
      text: node.desc || '',
      images: xhsImage(node),
      isVideo: node.type === 'video',
      likes: node.likes || node.liked_count || (node.interact_info && node.interact_info.liked_count) || null,
      createdAt: (node.time || node.create_time || 0) * (node.time > 1e12 ? 1 : 1000),
      url: 'https://www.xiaohongshu.com/explore/' + node.id + token,
      source: endpoint,
    });
    return false;
  });
  return out;
}

// ---------- 存储 ----------

function load(platform) {
  try {
    const raw = $persistentStore.read(STORE_KEYS[platform]);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function persist(platform, list) {
  return $persistentStore.write(JSON.stringify(list), STORE_KEYS[platform]);
}

/** 新内容按信息流顺序插到最前面；已存在的只更新 lastSeen，不打乱位置。 */
function save(platform, items, now) {
  if (!items.length) return 0;
  const list = load(platform);
  const index = {};
  list.forEach((it, i) => { index[it.id] = i; });

  const fresh = [];
  const batch = {};
  items.forEach(it => {
    if (batch[it.id]) return;
    batch[it.id] = true;
    if (index[it.id] !== undefined) {
      list[index[it.id]].lastSeen = now;
    } else {
      it.firstSeen = now;
      it.lastSeen = now;
      fresh.push(it);
    }
  });

  let merged = fresh.concat(list).slice(0, maxItems());
  // 写入失败（可能超过存储上限）时砍半重试
  while (!persist(platform, merged) && merged.length > 50) {
    merged = merged.slice(0, Math.floor(merged.length / 2));
  }
  return fresh.length;
}

function capture(url, body) {
  let platform;
  if (/(twitter|x)\.com\//.test(url)) platform = 'twitter';
  else if (/xiaohongshu\.com\//.test(url)) platform = 'xhs';
  else return 0;

  const json = JSON.parse(body);
  const items = platform === 'twitter' ? extractTwitter(json, url) : extractXhs(json, url);
  const added = save(platform, items, Date.now());
  log({ url: url, size: body.length, found: items.length, added: added });
  return added;
}

// ---------- 诊断日志：最近 30 次拦截 ----------

const LOG_KEY = 'lostfeed.log';

function readLog() {
  try {
    const list = JSON.parse($persistentStore.read(LOG_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function log(entry) {
  try {
    entry.t = Date.now();
    entry.url = String(entry.url || '').split('?')[0];
    $persistentStore.write(JSON.stringify([entry].concat(readLog()).slice(0, 30)), LOG_KEY);
  } catch (e) {}
}

function renderDebug() {
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const rows = readLog().map(e => {
    const d = new Date(e.t);
    const time = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    const result = e.error ? '<b style="color:#ff2442">出错：' + esc(e.error) + '</b>' : '解析到 ' + e.found + ' 条，新增 ' + e.added + ' 条';
    return '<li><small>' + time + ' · ' + Math.round((e.size || 0) / 1024) + 'KB</small><br><code>' + esc(e.url.replace(/^https:\/\//, '')) + '</code><br>' + result + '</li>';
  }).join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>LostFeed 诊断</title><style>body{font:14px/1.5 -apple-system,sans-serif;margin:0;padding:16px;background:#f6f6f4;color:#1d1d1b}'
    + '@media (prefers-color-scheme:dark){body{background:#111;color:#eee}}li{margin-bottom:12px;word-break:break-all}code{font-size:12px}small{color:#8a8a85}ol{padding-left:20px}</style></head><body>'
    + '<p><a href="/">← 返回</a></p><h2>最近拦截到的请求</h2>'
    + (rows ? '<ol>' + rows + '</ol>' : '<p>还没有拦截到任何请求。<br>请确认：小火箭已开启、LostFeed 模块已勾选、HTTPS 解密已打开且证书已信任，然后去刷一下再回来看。</p>')
    + '<p><small>截图这个页面就能帮忙排查问题。</small></p></body></html>';
}

// ---------- 查看页面 ----------

function htmlResponse(html, status) {
  return {
    response: {
      status: status || 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      body: html,
    },
  };
}

function jsonResponse(obj) {
  return {
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify(obj, null, 2),
    },
  };
}

function handleViewer(url) {
  const path = pathOf(url);
  const q = queryOf(url);
  const platforms = q.p && STORE_KEYS[q.p] ? [q.p] : Object.keys(STORE_KEYS);

  if (path === '/api/clear') {
    platforms.forEach(p => persist(p, []));
    return jsonResponse({ ok: true, cleared: platforms });
  }
  if (path === '/api/export') {
    const data = {};
    platforms.forEach(p => { data[p] = load(p); });
    return jsonResponse(data);
  }
  if (path === '/debug') return htmlResponse(renderDebug());
  const data = {};
  Object.keys(STORE_KEYS).forEach(p => { data[p] = load(p); });
  return htmlResponse(renderPage(data));
}

function renderPage(data) {
  // 防止内容里的 </script> 截断脚本
  const payload = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  const names = JSON.stringify(PLATFORM_NAMES);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>刷过的内容</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="刷过的">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="apple-touch-icon" href="${ICON_URL}">
<link rel="icon" href="${ICON_URL}">
<style>
:root{--bg:#f6f6f4;--card:#fff;--text:#1d1d1b;--muted:#8a8a85;--line:#e6e6e1;--accent:#1d9bf0;--xhs:#ff2442}
@media (prefers-color-scheme:dark){:root{--bg:#111;--card:#1c1c1c;--text:#eee;--muted:#8d8d8d;--line:#2c2c2c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);padding:calc(env(safe-area-inset-top) + 12px) 16px 10px;border-bottom:1px solid var(--line)}
h1{font-size:20px;margin:0 0 10px}
.tabs{display:flex;gap:8px;margin-bottom:10px}
.tab{flex:1;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;padding:8px;font-size:14px}
.tab.on{background:var(--text);color:var(--bg);border-color:var(--text)}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;padding:8px 10px;font-size:15px}
.btn{border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:10px;padding:0 12px;font-size:13px}
main{padding:12px 16px 40px;max-width:680px;margin:0 auto}
.day{color:var(--muted);font-size:13px;margin:16px 0 8px}
.item{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px;color:inherit;text-decoration:none}
.meta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;margin-bottom:4px}
.who{font-weight:600;color:var(--text);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:11px;padding:1px 6px;border-radius:6px;color:#fff;background:var(--accent);margin-right:6px}
.tag.xhs{background:var(--xhs)}
.title{font-weight:600;margin:2px 0}
.text{white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
.imgs{display:flex;gap:6px;margin-top:8px;overflow-x:auto}
.imgs img{height:110px;border-radius:8px;object-fit:cover;background:var(--line)}
.empty{color:var(--muted);text-align:center;padding:60px 0}
h1{display:flex;justify-content:space-between;align-items:center}
.refresh{border:0;background:none;color:var(--muted);font-size:22px;padding:0 4px}
.tip{display:none;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:12px 16px 0;font-size:14px;max-width:648px}
.tip b{color:var(--xhs)}
.tip .x{float:right;border:0;background:none;color:var(--muted);font-size:18px;line-height:1}
</style>
</head>
<body>
<header>
  <h1>刷过的内容<button class="refresh" onclick="location.reload()" aria-label="刷新">↻</button></h1>
  <div class="tabs" id="tabs"></div>
  <div class="row"><input id="q" type="search" placeholder="搜索作者 / 内容"><button class="btn" id="clear">清空</button></div>
</header>
<div class="tip" id="tip"><button class="x" id="tipx">×</button>📌 <b>放到桌面更方便：</b>点下方 <b>分享按钮</b> → <b>添加到主屏幕</b>，以后点桌面上的「刷过的」图标就能直接看。<br><small style="color:var(--muted)">记得保持小火箭开着，否则打不开。</small></div>
<main id="list"></main>
<p style="text-align:center;font-size:12px;color:var(--muted);padding-bottom:30px">推特请用 Safari 打开 x.com 刷（X App 无法记录）· <a href="/debug" style="color:var(--muted)">诊断</a></p>
<script>
const DATA=${payload};
const NAMES=${names};
let cur='all';
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function all(){
  const out=[];
  for(const p in DATA){ if(cur==='all'||cur===p) DATA[p].forEach(it=>out.push(Object.assign({p},it))); }
  return out.sort((a,b)=>b.firstSeen-a.firstSeen);
}
function fmtDay(t){const d=new Date(t);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();}
function fmtTime(t){const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function renderTabs(){
  const total=Object.values(DATA).reduce((n,l)=>n+l.length,0);
  const tabs=[['all','全部',total]].concat(Object.keys(DATA).map(p=>[p,NAMES[p],DATA[p].length]));
  $('#tabs').innerHTML=tabs.map(([k,n,c])=>'<button class="tab'+(k===cur?' on':'')+'" data-k="'+k+'">'+n+' '+c+'</button>').join('');
}
function render(){
  renderTabs();
  const kw=$('#q').value.trim().toLowerCase();
  const items=all().filter(it=>!kw||[it.author,it.handle,it.title,it.text].join(' ').toLowerCase().includes(kw));
  if(!items.length){$('#list').innerHTML='<div class="empty">'+(kw?'没有搜到相关内容':'还没有记录<br><br>保持小火箭开启，去刷一会儿推特或小红书，<br>再回来点右上角 ↻ 刷新')+'</div>';return;}
  let html='',day='';
  for(const it of items.slice(0,500)){
    const d=fmtDay(it.firstSeen);
    if(d!==day){day=d;html+='<div class="day">'+d+'</div>';}
    const who=it.p==='twitter'?esc(it.author)+(it.handle?' @'+esc(it.handle):''):esc(it.author);
    html+='<a class="item" href="'+esc(it.url)+'" target="_blank" rel="noreferrer">'
      +'<div class="meta"><span class="who"><span class="tag '+it.p+'">'+NAMES[it.p]+'</span>'+who+'</span><span>'+(it.rtBy?esc(it.rtBy)+' 转推 · ':'')+fmtTime(it.firstSeen)+'</span></div>'
      +(it.title?'<div class="title">'+esc(it.title)+'</div>':'')
      +(it.text?'<div class="text">'+esc(it.text)+'</div>':'')
      +(it.images&&it.images.length?'<div class="imgs">'+it.images.map(u=>'<img loading="lazy" referrerpolicy="no-referrer" src="'+esc(u)+'">').join('')+'</div>':'')
      +'</a>';
  }
  $('#list').innerHTML=html;
}
$('#tabs').addEventListener('click',e=>{const k=e.target.dataset&&e.target.dataset.k;if(k){cur=k;render();}});
$('#q').addEventListener('input',render);
$('#clear').addEventListener('click',async()=>{
  const label=cur==='all'?'全部':NAMES[cur];
  if(!confirm('确定清空「'+label+'」的记录？'))return;
  await fetch('/api/clear'+(cur==='all'?'':'?p='+cur));
  if(cur==='all')for(const p in DATA)DATA[p]=[];else DATA[cur]=[];
  render();
});
(function(){
  let hidden=false;try{hidden=localStorage.getItem('fh.tip')==='1';}catch(e){}
  if(!navigator.standalone&&!hidden)$('#tip').style.display='block';
  $('#tipx').onclick=()=>{$('#tip').style.display='none';try{localStorage.setItem('fh.tip','1');}catch(e){}};
})();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigator.standalone)location.reload();});
render();
</script>
</body>
</html>`;
}

// ---------- 入口 ----------

if (typeof module !== 'undefined' && module.exports && typeof $done === 'undefined') {
  module.exports = { extractTwitter, extractXhs, save, load, handleViewer, capture };
} else {
  const url = ($request && $request.url) || '';
  if (typeof $response === 'undefined' && VIEWER_RE.test(url)) {
    let res;
    try {
      res = handleViewer(url);
    } catch (e) {
      res = htmlResponse('<pre>LostFeed 出错：' + String(e && e.stack || e).replace(/</g, '&lt;') + '</pre>', 500);
    }
    $done(res);
  } else {
    try {
      if (typeof $response !== 'undefined' && $response.body) capture(url, $response.body);
    } catch (e) {
      console.log('[lostfeed] ' + (e && e.message || e));
      log({ url: url, size: ($response && $response.body || '').length, error: String(e && e.message || e) });
    }
    $done({}); // 原样放行
  }
}
