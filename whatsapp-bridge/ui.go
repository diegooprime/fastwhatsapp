package main

const uiHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp Explorer</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e1e1e1;height:100vh;overflow:hidden}
.app{display:flex;height:100vh}
.sidebar{width:340px;border-right:1px solid #1a1a1a;display:flex;flex-direction:column;background:#111}
.sidebar-header{padding:16px;border-bottom:1px solid #1a1a1a}
.sidebar-header h1{font-size:16px;font-weight:600;color:#25D366;margin-bottom:12px}
.search{width:100%;padding:10px 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;color:#e1e1e1;font-size:14px;outline:none}
.search:focus{border-color:#25D366}
.chat-list{flex:1;overflow-y:auto}
.chat-item{padding:14px 16px;border-bottom:1px solid #141414;cursor:pointer;display:flex;align-items:center;gap:12px;transition:background .15s}
.chat-item:hover{background:#1a1a1a}
.chat-item.active{background:#1a2a1a}
.chat-avatar{width:42px;height:42px;border-radius:50%;background:#1e3a2a;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:#25D366;flex-shrink:0}
.chat-info{flex:1;min-width:0}
.chat-name-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}
.chat-name{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-time{font-size:11px;color:#666;flex-shrink:0;margin-left:8px}
.chat-preview-row{display:flex;justify-content:space-between;align-items:center}
.chat-preview{font-size:12px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-badge{background:#25D366;color:#000;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0;margin-left:8px}
.main{flex:1;display:flex;flex-direction:column;background:#0a0a0a}
.main-header{padding:14px 20px;border-bottom:1px solid #1a1a1a;display:flex;justify-content:space-between;align-items:center;background:#111}
.main-header h2{font-size:15px;font-weight:500}
.main-header span{font-size:12px;color:#666;margin-left:10px}
.btn-delete{background:#dc2626;color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:500}
.btn-delete:hover{background:#b91c1c}
.messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:4px}
.msg{max-width:65%;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.5;word-wrap:break-word}
.msg.incoming{align-self:flex-start;background:#1a1a1a;border-bottom-left-radius:2px}
.msg.outgoing{align-self:flex-end;background:#1a3a2a;border-bottom-right-radius:2px}
.msg .sender{font-size:11px;color:#25D366;font-weight:600;margin-bottom:2px}
.msg .time{font-size:10px;color:#555;margin-top:3px;text-align:right}
.msg .media-tag{font-size:11px;color:#999;font-style:italic}
.empty{flex:1;display:flex;align-items:center;justify-content:center;color:#444;font-size:15px}
.modal-bg{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:100}
.modal-bg.show{display:flex}
.modal{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:24px;max-width:400px;width:90%}
.modal h3{margin-bottom:12px;font-size:16px}
.modal p{color:#999;font-size:13px;margin-bottom:20px}
.modal-btns{display:flex;gap:10px;justify-content:flex-end}
.modal-btns button{padding:8px 18px;border-radius:6px;border:none;font-size:13px;cursor:pointer;font-weight:500}
.btn-cancel{background:#2a2a2a;color:#e1e1e1}
.btn-confirm{background:#dc2626;color:#fff}
.date-sep{text-align:center;font-size:11px;color:#555;padding:12px 0 4px}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px}
</style>
</head>
<body>
<div class="app">
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>WhatsApp Explorer</h1>
      <input class="search" type="text" placeholder="Search chats..." id="search">
    </div>
    <div class="chat-list" id="chatList"></div>
  </div>
  <div class="main">
    <div class="main-header" id="mainHeader" style="display:none">
      <div><h2 id="chatTitle"></h2><span id="chatMsgCount"></span></div>
      <button class="btn-delete" id="btnDelete" onclick="showDeleteModal()">Delete Chat</button>
    </div>
    <div class="messages" id="messages">
      <div class="empty">Select a chat to view messages</div>
    </div>
  </div>
</div>
<div class="modal-bg" id="modalBg">
  <div class="modal">
    <h3>Delete Chat</h3>
    <p id="modalText">Are you sure? This will permanently delete this chat and all its messages.</p>
    <div class="modal-btns">
      <button class="btn-cancel" onclick="hideDeleteModal()">Cancel</button>
      <button class="btn-confirm" onclick="confirmDelete()">Delete</button>
    </div>
  </div>
</div>
<script>
const API_KEY = "{{.APIKey}}";
const H = {"X-API-Key": API_KEY, "Content-Type": "application/json"};
let chats = [], activeChat = null;

async function api(path, opts = {}) {
  const r = await fetch(path, {...opts, headers: H});
  return r.json();
}

function relTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 86400 && d.getDate() === now.getDate()) return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  if (diff < 172800) return "Yesterday";
  if (diff < 604800) return d.toLocaleDateString([], {weekday:"short"});
  return d.toLocaleDateString([], {month:"short", day:"numeric"});
}

function dateStr(ts) {
  const d = new Date(ts * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(y.getDate()-1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric", year:"numeric"});
}

function renderChats(filter = "") {
  const el = document.getElementById("chatList");
  const f = filter.toLowerCase();
  const filtered = f ? chats.filter(c => c.name.toLowerCase().includes(f)) : chats;
  el.innerHTML = filtered.map(c => {
    const initial = (c.name || "?")[0].toUpperCase();
    const preview = c.lastMessage ? (c.lastMessage.length > 40 ? c.lastMessage.slice(0,40)+"..." : c.lastMessage) : "";
    return '<div class="chat-item'+(activeChat&&activeChat.id===c.id?' active':'')+'" onclick="loadChat(\''+c.id.replace(/'/g,"\\'")+'\')">' +
      '<div class="chat-avatar">'+initial+'</div>' +
      '<div class="chat-info">' +
        '<div class="chat-name-row"><span class="chat-name">'+esc(c.name)+'</span><span class="chat-time">'+relTime(c.lastMessageTimestamp)+'</span></div>' +
        '<div class="chat-preview-row"><span class="chat-preview">'+esc(preview)+'</span>'+(c.messageCount?'<span class="chat-badge">'+c.messageCount+'</span>':'')+'</div>' +
      '</div></div>';
  }).join("");
}

function esc(s) { if(!s)return""; const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }

async function loadChat(chatId) {
  activeChat = chats.find(c => c.id === chatId);
  renderChats(document.getElementById("search").value);
  document.getElementById("mainHeader").style.display = "flex";
  document.getElementById("chatTitle").textContent = activeChat.name;
  document.getElementById("chatMsgCount").textContent = activeChat.messageCount + " messages";
  const el = document.getElementById("messages");
  el.innerHTML = '<div class="empty">Loading...</div>';
  const data = await api("/chats/"+encodeURIComponent(chatId)+"/messages?limit=5000");
  const msgs = (data.messages || []).slice().sort((a,b) => a.timestamp - b.timestamp);
  if (!msgs.length) { el.innerHTML = '<div class="empty">No messages</div>'; return; }
  let html = "", lastDate = "";
  msgs.forEach(m => {
    const d = dateStr(m.timestamp);
    if (d !== lastDate) { html += '<div class="date-sep">'+d+'</div>'; lastDate = d; }
    const cls = m.fromMe ? "outgoing" : "incoming";
    const t = new Date(m.timestamp*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    let body = m.body ? esc(m.body) : "";
    if (m.hasMedia && !body) body = '<span class="media-tag">['+esc(m.mediaType||"media")+']</span>';
    else if (m.hasMedia) body += ' <span class="media-tag">['+esc(m.mediaType||"media")+']</span>';
    const sender = (!m.fromMe && m.senderName) ? '<div class="sender">'+esc(m.senderName)+'</div>' : "";
    html += '<div class="msg '+cls+'">'+sender+body+'<div class="time">'+t+'</div></div>';
  });
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function showDeleteModal() { document.getElementById("modalBg").classList.add("show"); }
function hideDeleteModal() { document.getElementById("modalBg").classList.remove("show"); }

async function confirmDelete() {
  if (!activeChat) return;
  hideDeleteModal();
  await api("/chats/"+encodeURIComponent(activeChat.id), {method:"DELETE"});
  chats = chats.filter(c => c.id !== activeChat.id);
  activeChat = null;
  renderChats(document.getElementById("search").value);
  document.getElementById("mainHeader").style.display = "none";
  document.getElementById("messages").innerHTML = '<div class="empty">Chat deleted</div>';
}

document.getElementById("search").addEventListener("input", e => renderChats(e.target.value));

(async () => {
  const data = await api("/chats");
  chats = data.chats || [];
  renderChats();
})();
</script>
</body>
</html>`
