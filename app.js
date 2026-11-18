"use strict";
const $ = id => document.getElementById(id);
const DEFAULT = "#defcon", SERVER = "*server*";
const NICK = /^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\[\]\\`_^{|}-]{0,29}$/;
const CHANNEL = /^[#&][^\s,:\x00-\x1f\x7f]{1,49}$/;
const commands = [
  ["/join #channel", "Join another channel."], ["/part", "Leave this channel."],
  ["/msg nick text", "Send a direct message."], ["/me action", "Describe an action."],
  ["/nick newname", "Change your nickname."], ["/quit", "Disconnect from 2600net."],
  ["/help", "Show this command list."]
];
const rooms = new Map();
let state = "offline", socket = null, self = "", active = DEFAULT;
let connectionText = "", connectionError = false, dialogKind = "";
let casing = "rfc1459", prefixes = "~&@%+";
const fold = value => {
  const lower = value.toLowerCase();
  if (casing === "ascii") return lower;
  const rfc = lower.replace(/\[/g, "{").replace(/\]/g, "}").replace(/\\/g, "|");
  return casing === "strict-rfc1459" ? rfc : rfc.replace(/\^/g, "~");
};
const same = (a, b) => fold(a) === fold(b);
const clean = value => String(value ?? "").replace(/\x03(?:\d{1,2}(?:,\d{1,2})?)?/g, "").replace(/[\x00-\x1f\x7f]/g, "");
const isChannel = value => CHANNEL.test(value);
const isService = name => /^(nickserv|chanserv|memoserv|operserv|hostserv|botserv|global|ns|cs)$/i.test(name);
function saved(key) {
  try { return localStorage.getItem("sideband." + key) || ""; } catch { return ""; }
}
function save(key, value) {
  try { localStorage.setItem("sideband." + key, value); } catch { /* Session still works. */ }
}
function elem(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function getRoom(name) {
  const key = fold(name);
  if (!rooms.has(key)) rooms.set(key, {
    name, lines: [], members: new Map(), namesComplete: false, topic: "", joined: false,
    joining: false, unread: 0, draft: "", notice: ""
  });
  return rooms.get(key);
}
function rowNode(item) {
  const row = elem("div", undefined, "row " + item.type);
  const stamp = elem("time", item.at.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", hourCycle:"h23"}));
  stamp.dateTime = item.at.toISOString();
  const content = elem("div");
  if (item.who) content.append(elem("b", item.who, "who"));
  content.append(elem("span", item.text, "words"));
  row.append(stamp, content);
  return row;
}
function add(name, text, who = "", type = "info") {
  const r = getRoom(name);
  const item = {text: clean(text), who: clean(who), at: new Date(), type};
  r.lines.push(item);
  if (r.lines.length > 500) r.lines.shift();
  if (same(name, active)) {
    const pane = $("chat"), log = $("history");
    const atEnd = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 54;
    log.append(rowNode(item));
    if (log.children.length > 500) log.firstChild.remove();
    $("emptyChat").hidden = true;
    if (atEnd) pane.scrollTop = pane.scrollHeight;
  } else if (name !== SERVER && (type === "message" || type === "action")) {
    r.unread++;
    drawTabs();
  }
}
function tab(r) {
  const button = elem("button", undefined, "tab");
  const channel = isChannel(r.name);
  button.append(elem("span", channel ? r.name[0] : "@", "sig"), elem("span", channel ? r.name.slice(1) : r.name));
  if (same(r.name, active)) button.setAttribute("aria-current","page");
  if (r.unread) {
    const badge = elem("span", String(r.unread), "unread");
    badge.setAttribute("aria-label", r.unread + " unread messages");
    button.append(badge);
  }
  button.onclick = () => selectRoom(r.name);
  return button;
}
function drawTabs() {
  const channels = [], privates = [];
  for (const r of rooms.values()) {
    if (r.name !== SERVER) (isChannel(r.name) ? channels : privates).push(tab(r));
  }
  $("channels").replaceChildren(...channels);
  $("privates").replaceChildren(...privates);
  $("privateSection").hidden = !privates.length;
  if (active === SERVER) $("serverTab").setAttribute("aria-current","page");
  else $("serverTab").removeAttribute("aria-current");
}
function navOpen(open) {
  $("sidebar").classList.toggle("open", open);
  $("navToggle").setAttribute("aria-expanded", String(open));
}
function selectRoom(name) {
  getRoom(active).draft = $("message").value;
  const r = getRoom(name);
  active = r.name;
  r.unread = 0;
  $("message").value = r.draft;
  navOpen(false);
  drawTabs();
  render(true);
}
function memberInfo() {
  const r = getRoom(active);
  $("members").hidden = !isChannel(r.name);
  $("members").disabled = state !== "online" || !r.joined;
  $("memberCount").textContent = r.namesComplete && r.joined ? "· " + r.members.size : "";
  if (dialogKind === "members" && $("modal").open) drawMembers();
}
function render(history = false) {
  const r = getRoom(active), server = active === SERVER, channel = isChannel(active);
  const entry = same(active, DEFAULT) && !r.lines.length && state !== "online";
  const usable = state === "online" && (!channel || r.joined);
  $("viewName").textContent = server ? "Server log" : channel ? active.slice(1) : active;
  $("viewGlyph").textContent = server ? "›_" : channel ? active[0] : "@";
  $("entry").hidden = !entry;
  $("chat").hidden = entry;
  $("composer").hidden = entry || !usable;
  $("message").placeholder = server ? "Enter an IRC command" : "Message " + active;
  $("composeLabel").textContent = $("message").placeholder;
  $("topic").hidden = !r.topic || !r.joined || !channel;
  $("topic").textContent = r.topic;
  $("notices").hidden = entry || !r.notice;
  $("notices").textContent = r.notice;
  $("sessionActions").hidden = entry || state === "connecting" || usable || (state === "online" && r.joining);
  $("roomAction").textContent = state === "online" ? "Join " + r.name : "Connect to 2600net";
  $("statusText").textContent = {offline:"Offline", connecting:"Connecting", online:"Connected"}[state];
  $("statusLamp").className = {offline:"", connecting:"wait", online:"on"}[state];
  $("identity").textContent = state === "online" ? " / " + self : "";
  $("stop").hidden = state === "offline";
  $("stop").textContent = state === "connecting" ? "Cancel" : "Disconnect";
  $("addChannel").disabled = state !== "online";
  $("nickname").disabled = state !== "offline";
  $("connect").disabled = state !== "offline";
  $("networkHelp").hidden = !connectionError || state !== "offline";
  $("connectFeedback").textContent = connectionText;
  $("connectFeedback").classList.toggle("error",connectionError);
  $("emptyChat").hidden = !!r.lines.length;
  $("emptyChat").textContent = server ? "Connection events and network replies appear here." : r.joining ? "Waiting for the channel to accept your join…" : "Messages appear here during this session.";
  if (history) {
    $("history").replaceChildren(...r.lines.map(rowNode));
    $("chat").scrollTop = $("chat").scrollHeight;
  }
  memberInfo();
}
function inform(text, name = active) {
  getRoom(name).notice = text;
  add(SERVER, text, "", "error");
  render();
}
function modal(title, kind) {
  if ($("modal").open) $("modal").close();
  dialogKind = kind;
  $("dialogTitle").textContent = title;
  $("dialogBody").replaceChildren();
  return $("dialogBody");
}
function showCommands() {
  const body = modal("IRC commands", "commands"), list = elem("div", undefined, "cmdlist");
  for (const [syntax, meaning] of commands) {
    const row = elem("div");
    row.append(elem("code",syntax), elem("span",meaning));
    list.append(row);
  }
  body.append(list, elem("p","Your browser connects to 2600net’s WebSocket gateway. Chat history stays in this tab until you reload or close it.","dialogText"));
  $("modal").showModal();
}
function showDisplay() {
  const body = modal("Display", "display"), form = elem("div", undefined, "dialogForm");
  const label = elem("label","Color theme"), select = elem("select");
  label.htmlFor = select.id = "themeSelect";
  for (const [value, title] of [["night","Night"],["day","Day"],["contrast","High contrast"]]) {
    const opt = elem("option",title); opt.value = value; select.append(opt);
  }
  select.value = document.documentElement.dataset.theme;
  select.onchange = () => { document.documentElement.dataset.theme = select.value; save("theme", select.value); };
  form.append(label,select); body.append(form); $("modal").showModal();
}
function formDialog(title, kind, labelText, initial, actionLabel, handler) {
  const body = modal(title, kind), form = elem("form", undefined, "dialogForm");
  const label = elem("label",labelText), input = elem("input");
  label.htmlFor = input.id = "dialogInput";
  input.autocomplete = "off"; input.autocapitalize = "none"; input.spellcheck = false; input.value = initial; input.required = true;
  const button = elem("button",actionLabel,"primary");
  form.onsubmit = evt => {
    evt.preventDefault(); input.setCustomValidity("");
    const problem = handler(input.value.trim());
    if (problem) { input.setCustomValidity(problem); input.reportValidity(); }
    else $("modal").close();
  };
  input.oninput = () => input.setCustomValidity("");
  form.append(label,input,button); body.append(form); $("modal").showModal(); input.focus();
}
function validNick(n) { return NICK.test(n) ? "" : "Use 1–30 IRC nickname characters. Start with a letter or an IRC nickname symbol."; }
const GATEWAY = "wss://wpm.2600.chat/webirc/websocket/";
const OPEN_FAILED = "Couldn’t open 2600net’s WebSocket from this page. Check your connection, retry, or use the network’s web chat below.";
const byteCounter = new TextEncoder();
let registrationTimer = 0, recentWrites = [];

function sendLine(ws, line) {
  if (/[\r\n\x00]/.test(line)) throw new Error("Send one IRC line at a time.");
  if (byteCounter.encode(line).length > 510) throw new Error("This message is too long for IRC. Shorten it and send again.");
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 65536) throw new Error("The connection is busy or closed. Try sending again.");
  ws.send(line);
}

function parseLine(line) {
  const match = /^(?:@\S+ +)?(?::(\S+) +)?([a-zA-Z]+|\d{3})(?: +(.*))?$/.exec(line);
  if (!match) return null;
  const args = [], rest = match[3] || "";
  for (const param of rest.matchAll(/(?:^| +)(?::(.*)|(\S+))/g)) {
    args.push(param[1] ?? param[2]);
  }
  return {from:match[1] || "", code:match[2].toUpperCase(), args};
}

function receiveLine(ws, line) {
  const packet = parseLine(line);
  if (!packet) return;
  const {code, args} = packet;
  if (code === "PING") { sendLine(ws, "PONG :" + (args.at(-1) || "")); return; }
  if (code === "ERROR") { end(clean(args.at(-1)) || "2600net closed the connection.", true); return; }
  if (state === "connecting") {
    if (["432","433","436","437"].includes(code)) {
      end("That nickname is unavailable. Choose another nickname and reconnect.", true); return;
    }
    if (["463","464","465","466"].includes(code)) {
      end(clean(args.at(-1)) || "2600net declined registration.", true); return;
    }
  }
  if (code === "001") {
    if (state !== "connecting" || !args.length) return;
    clearTimeout(registrationTimer);
    sendLine(ws, "JOIN " + DEFAULT);
  }
  onIRC(packet);
}

function connect(n) {
  const problem = validNick(n); if (problem) return problem;
  if (state !== "offline") return "A connection is already in progress.";
  $("nickname").value = n; save("nickname", n);
  connectionText = "Opening 2600net’s secure WebSocket…"; connectionError = false;
  recentWrites = []; self = n; state = "connecting"; getRoom(DEFAULT).notice = "";
  selectRoom(DEFAULT); add(SERVER,"Opening " + GATEWAY);
  let ws;
  try { ws = new WebSocket(GATEWAY); }
  catch { end(OPEN_FAILED,true); return ""; }
  socket = ws;
  ws.binaryType = "arraybuffer";
  registrationTimer = setTimeout(() => {
    if (ws === socket && state === "connecting") end("Timed out waiting for 2600net. Retry or use its web chat below.",true);
  }, 45000);
  ws.onopen = () => {
    if (ws !== socket) return;
    connectionText = "Waiting for 2600net to accept your nickname…"; render();
    try {
      sendLine(ws,"HOST irc.2600.net:+6697");
      sendLine(ws,"NICK " + n);
      sendLine(ws,"USER sideband 0 * :Sideband IRC");
    } catch (err) { end(err.message, true); }
  };
  ws.onmessage = event => {
    if (ws !== socket) return;
    const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
    try {
      for (const line of text.split(/\r\n|\r|\n/)) {
        if (ws !== socket) break;
        if (line) receiveLine(ws,line);
      }
    } catch (err) { end("Couldn’t process the network reply. " + err.message,true); }
  };
  ws.onclose = event => {
    if (ws !== socket) return;
    const detail = clean(event.reason);
    const fallback = state === "connecting" ? OPEN_FAILED : "The connection to 2600net closed. Reconnect to rejoin #defcon.";
    end(detail ? fallback + " (" + detail + ")" : fallback, true);
  };
  return "";
}
function end(text, error) {
  clearTimeout(registrationTimer);
  const old = socket; socket = null;
  if (old && old.readyState < WebSocket.CLOSING) old.close();
  if (dialogKind === "members" && $("modal").open) $("modal").close();
  state = "offline";
  for (const r of rooms.values()) { r.joined = false; r.joining = false; r.members.clear(); r.namesComplete = false; }
  connectionText = text; connectionError = error;
  getRoom(active).notice = text;
  add(SERVER,text,"", error ? "error" : "info");
  render();
}
function disconnect() {
  if (!socket) return;
  if (state === "online" && socket.readyState === WebSocket.OPEN) {
    try { sendLine(socket,"QUIT :Left Sideband"); } catch { /* Close even if the send buffer is full. */ }
  }
  end(state === "connecting" ? "Connection cancelled." : "You disconnected.",false);
}
function request(cmd) {
  if (state !== "online" || socket?.readyState !== WebSocket.OPEN) { inform("Reconnect before sending."); return false; }
  recentWrites = recentWrites.filter(t => Date.now() - t < 5000);
  if (recentWrites.length >= 6) { inform("Wait a few seconds before sending again."); return false; }
  let line;
  switch (cmd.type) {
    case "chat":
    case "action":
      if (!isChannel(cmd.target) && !NICK.test(cmd.target)) { inform("Choose a valid channel or nickname."); return false; }
      if (/[\x00-\x1f\x7f]/.test(cmd.text)) { inform("Remove control characters before sending."); return false; }
      line = "PRIVMSG " + cmd.target + " :" + (cmd.type === "action" ? "\x01ACTION " + cmd.text + "\x01" : cmd.text);
      break;
    case "join": case "part": line = cmd.type.toUpperCase() + " " + cmd.channel; break;
    case "nick": line = "NICK " + cmd.nickname; break;
    default: return false;
  }
  try { sendLine(socket,line); } catch (err) { inform(err.message); return false; }
  recentWrites.push(Date.now());
  if (cmd.type === "action" || cmd.type === "chat") {
    add(cmd.target,isService(cmd.target) ? "[Service message sent]" : cmd.text,self,cmd.type === "action" ? "action" : "message");
    if (!isChannel(cmd.target) && !same(active,cmd.target)) selectRoom(cmd.target);
    else drawTabs();
  }
  return true;
}
function join(name) {
  if (!CHANNEL.test(name)) return "Use a channel name beginning with # or &.";
  if (state !== "online") return "Connect to 2600net first.";
  const room = getRoom(name); selectRoom(name); room.notice = "";
  if (!room.joined && !room.joining) {
    room.joining = request({type:"join", channel:name});
  }
  render(); return "";
}
function drawMembers() {
  const r = getRoom(active), body = $("dialogBody");
  const list = elem("ul",undefined,"memberList");
  const names = [...r.members.values()].sort((a,b) => a.localeCompare(b));
  for (const nick of names) {
    const li = elem("li"), pick = elem("button",same(nick,self) ? nick + " (you)" : nick);
    pick.disabled = same(nick,self); pick.title = "Open a direct message";
    pick.onclick = () => { $("modal").close(); selectRoom(nick); $("message").focus(); };
    li.append(pick); list.append(li);
  }
  body.replaceChildren(elem("p",names.length ? "Select a nickname to open a direct message." : "Waiting for the server’s member list…","dialogText"),list);
}
function renameNick(before, after) {
  for (const r of rooms.values()) {
    if (r.members.delete(fold(before))) {
      r.members.set(fold(after),after); add(r.name,before + " is now known as " + after + ".");
    }
  }
  const previous = rooms.get(fold(before));
  if (previous && !isChannel(before)) {
    const selected = same(active,before);
    rooms.delete(fold(before));
    const existing = rooms.get(fold(after));
    if (existing && existing !== previous) {
      previous.lines = [...previous.lines,...existing.lines].sort((a,b)=>a.at-b.at).slice(-500);
      previous.unread += existing.unread;
      previous.draft ||= existing.draft;
    }
    previous.name = after; rooms.set(fold(after),previous);
    if (selected) active = after;
  }
  if (same(before,self)) { self = after; $("nickname").value = after; save("nickname",after); }
  drawTabs(); render(true);
}
function onIRC({from,code,args:a}) {
  const nick = from.split("!")[0], last = clean(a.at(-1));
  if (code === "001") {
    self = a[0]; state = "online"; connectionText = "";
    getRoom(DEFAULT).joining = true;
    add(SERVER,last); render(); return;
  }
  if (code === "005") {
    for (const option of a) {
      if (option.startsWith("CASEMAPPING=")) casing = option.slice(12);
      if (option.startsWith("PREFIX=") && option.includes(")")) prefixes = option.split(")")[1];
    }
  }
  if (code === "JOIN") {
    const r = getRoom(a[0]); r.members.set(fold(nick),nick);
    if (same(nick,self)) {
      r.joined = true; r.joining = false; r.notice = ""; r.topic = "";
      add(r.name,"You joined " + r.name + "."); drawTabs();
      if (same(active,r.name)) { render(); $("message").focus(); }
    } else { add(r.name,nick + " joined."); }
    memberInfo(); return;
  }
  if (code === "353" && a.length >= 4) {
    const r = getRoom(a[2]);
    for (let name of a[3].split(" ")) {
      while (name && prefixes.includes(name[0])) name = name.slice(1);
      name = name.split("!")[0];
      if (name) r.members.set(fold(name),name);
    }
    return;
  }
  if (code === "366") { getRoom(a[1]).namesComplete = true; memberInfo(); return; }
  if (code === "PART" || code === "KICK") {
    const r = getRoom(a[0]), who = code === "PART" ? nick : a[1];
    r.members.delete(fold(who));
    const desc = code === "KICK" ? who + " was kicked by " + nick + (a[2] ? " ("+last+")" : "") : who + " left " + r.name;
    add(r.name,desc + ".");
    if (same(who,self)) {
      r.joined = false; r.joining = false; r.members.clear(); r.namesComplete = false;
      if ($("modal").open && dialogKind === "members") $("modal").close();
    }
    render(); return;
  }
  if (code === "QUIT") {
    for (const r of rooms.values()) if (r.members.delete(fold(nick))) add(r.name,nick + " quit" + (last ? " ("+last+")" : "") + ".");
    memberInfo(); return;
  }
  if (code === "NICK") { renameNick(nick,a[0]); return; }
  if (code === "332" || code === "TOPIC" || code === "331") {
    const r = getRoom(code === "TOPIC" ? a[0] : a[1]);
    r.topic = code === "331" ? "" : last;
    if (code === "TOPIC") add(r.name,nick + " changed the topic: " + last);
    render(); return;
  }
  if (code === "PRIVMSG" || code === "NOTICE") {
    if (a.length < 2) return;
    const dst = isChannel(a[0]) ? a[0] : from.includes("!") && same(a[0],self) ? nick : SERVER;
    const action = a[1].startsWith("\x01ACTION ") && a[1].endsWith("\x01");
    if (!action && a[1].startsWith("\x01")) return;
    add(dst,action ? a[1].slice(8,-1) : last,nick || "Network",action ? "action" : code === "NOTICE" ? "info" : "message");
    drawTabs(); return;
  }
  if (/^[45]\d\d$/.test(code)) {
    const candidate = a.slice(1,-1).find(x => rooms.has(fold(x)));
    const r = getRoom(candidate || active);
    r.joining = false; r.notice = code + " · " + (candidate ? candidate + " · " : "") + last;
    add(SERVER,r.notice,"","error");
    if (r.name !== SERVER) add(r.name,r.notice,"","error");
    render(); return;
  }
  if (code === "MODE" && isChannel(a[0])) { add(a[0],nick + " set mode " + a.slice(1).join(" ")); return; }
  if (code !== "PONG" && code !== "333") add(SERVER,[code,...a.slice(1)].join(" "));
}
function submitMessage() {
  const src = $("message").value, text = src.trim();
  if (!text) return;
  const origin = getRoom(active); origin.notice = "";
  let ok = false;
  if (!text.startsWith("/") || text.startsWith("//")) {
    if (active === SERVER) return inform("Select a conversation or enter an IRC command.");
    ok = request({type:"chat",target:active,text:text.startsWith("//") ? text.slice(1) : text});
  } else {
    const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) return inform("Enter a command after /, or type // to send a literal slash.");
    const cmd = match[1].toLowerCase(), value = match[2] || "";
    if (cmd === "help") { showCommands(); ok = true; }
    else if (cmd === "join") { const err = join(value); if (err) return inform(err); ok = true; }
    else if (cmd === "part") {
      if (!isChannel(active) || !origin.joined || value) return inform("Use /part in the channel you want to leave.");
      ok = request({type:"part",channel:active});
    } else if (cmd === "nick") {
      const err = validNick(value); if (err) return inform(err); ok = request({type:"nick",nickname:value});
    } else if (cmd === "me" && active !== SERVER && value) {
      ok = request({type:"action",target:active,text:value});
    } else if (cmd === "msg") {
      const pair = /^(\S+)\s+(.+)$/.exec(value);
      if (!pair || !NICK.test(pair[1])) return inform("Use /msg nickname message.");
      ok = request({type:"chat",target:pair[1],text:pair[2]});
    } else if (cmd === "quit") { disconnect(); ok = true; }
    else return inform("Check the command syntax. Type /help for examples.");
  }
  if (ok) {
    origin.draft = "";
    if (same(active,origin.name)) $("message").value = "";
    render();
  }
}
getRoom(DEFAULT); getRoom(SERVER);
const oldNick = saved("nickname");
const random = new Uint32Array(1); crypto.getRandomValues(random);
$("nickname").value = NICK.test(oldNick) ? oldNick : "guest" + (random[0] % 10000).toString().padStart(4,"0");
$("connectForm").onsubmit = event => {
  event.preventDefault();
  const problem = connect($("nickname").value.trim());
  if (problem) { connectionError = true; connectionText = problem; render(); $("nickname").focus(); }
};
$("composer").onsubmit = e => { e.preventDefault(); submitMessage(); };
$("message").oninput = () => { getRoom(active).draft = $("message").value; };
$("roomAction").onclick = () => {
  if (state === "online") join(active);
  else formDialog("Connect to #defcon","reconnect","Nickname",$("nickname").value,"Connect",connect);
};
$("serverTab").onclick = () => selectRoom(SERVER);
$("addChannel").onclick = () => formDialog("Join a channel","join","Channel","#","Join channel",join);
$("members").onclick = () => { modal("Members of " + active,"members"); drawMembers(); $("modal").showModal(); };
$("commands").onclick = showCommands; $("display").onclick = showDisplay;
$("closeModal").onclick = () => $("modal").close();
$("modal").addEventListener("click",event => {
  if (event.target !== $("modal")) return;
  const box = $("modal").getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $("modal").close();
});
$("navToggle").onclick = () => navOpen(!$("sidebar").classList.contains("open"));
document.addEventListener("keydown",e => { if (e.key === "Escape") navOpen(false); });
document.addEventListener("pointerdown",e => {
  if (!e.target.closest("#sidebar,#navToggle") && $("sidebar").classList.contains("open")) navOpen(false);
});
$("stop").onclick = disconnect;
drawTabs(); render(true);
