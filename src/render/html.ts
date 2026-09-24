/**
 * 单文件 HTML 查看器生成：布局坐标 + 图数据内嵌进一个零依赖 HTML，
 * 双击即可用浏览器打开。缩放/平移/详情侧栏/子模块跳转/状态统计全在前端完成。
 *
 * 注意：VIEWER_JS 内嵌进 HTML 后会原样执行，因此禁止使用反斜杠、反引号和 ${}，
 * 一律用字符串拼接和 split/join。
 */
import { FlowGraph, STATE_COLORS, STATE_LABELS } from "../core/schema.js";
import { LayoutResult } from "../layout/dagre.js";

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif;background:#f5f6f8}
#cv{width:100vw;height:100vh;display:block;cursor:grab}
#cv.panning{cursor:grabbing}
#topbar{position:fixed;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 16px;pointer-events:none}
.panel{background:#fff;border:1px solid #e2e5ea;border-radius:10px;box-shadow:0 1px 4px rgba(20,30,50,.08)}
#crumb{display:flex;gap:6px;align-items:center;padding:7px 12px;pointer-events:auto;font-size:14px;color:#1f2430;flex-wrap:wrap}
#crumb a{cursor:pointer;color:#2563eb;text-decoration:none}
#crumb .sep{color:#b6bdc9}
#crumb .cur{font-weight:600}
#rightbar{display:flex;gap:8px;align-items:center;pointer-events:auto;flex-wrap:wrap;justify-content:flex-end}
#stats{padding:7px 12px;font-size:12px;color:#4b5563;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#fitbtn{cursor:pointer;border:1px solid #e2e5ea;background:#fff;border-radius:10px;padding:7px 12px;font-size:12px;color:#4b5563}
#fitbtn:hover{background:#f2f4f7}
#hint{padding:7px 12px;font-size:12px;color:#8a93a3}
#legend{position:fixed;left:16px;bottom:16px;background:#fff;border:1px solid #e2e5ea;border-radius:10px;padding:8px 12px;font-size:12px;color:#4b5563;display:flex;gap:12px;flex-wrap:wrap;max-width:72vw;box-shadow:0 1px 4px rgba(20,30,50,.08)}
#detail{position:fixed;top:56px;right:16px;width:360px;max-height:calc(100vh - 130px);overflow:auto;background:#fff;border:1px solid #e2e5ea;border-radius:12px;padding:14px 16px;font-size:13px;color:#1f2430;box-shadow:0 6px 20px rgba(20,30,50,.12);display:none;line-height:1.65}
#detail h3{margin:0 40px 6px 0;font-size:15px}
#detail .row{display:flex;margin:4px 0}
#detail .k{color:#8a93a3;margin-right:8px;flex:0 0 auto}
#detail .val{word-break:break-all}
#detail .loc{background:#f2f4f7;border-radius:6px;padding:2px 6px;font-family:Consolas,monospace;font-size:12px}
#detail .copy{margin-left:8px;cursor:pointer;color:#2563eb;user-select:none}
#detail .close{position:absolute;top:12px;right:14px;cursor:pointer;color:#8a93a3;font-size:18px;line-height:1}
#detail pre{background:#f2f4f7;border-radius:8px;padding:8px;font-size:12px;overflow:auto;white-space:pre-wrap}
.badge{display:inline-block;padding:1px 9px;border-radius:999px;color:#fff;font-size:12px;vertical-align:1px}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
#toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:#1f2430;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .25s;pointer-events:none}
.node{cursor:pointer}
.node.dragged .body{stroke-dasharray:7 4}
text{user-select:none}
`;

const VIEWER_JS = `
var COLORS={completed:"#2ea44f",in_progress:"#61aeee",planned:"#0366d6",broken:"#d73a4a",to_plan:"#959da5",pending_decision:"#ffd33d",deprecated:"#92400e"};
var LABELS={completed:"已完成",in_progress:"进行中",planned:"已规划",broken:"存在Bug",to_plan:"待规划",pending_decision:"待决策",deprecated:"已废弃"};
var PORTED={module:1,llm:1,tool_call:1,agent:1,assemble:1};
var NL=String.fromCharCode(10);
var TYPE_NAMES={start:"开始",end:"结束",process:"处理",judge:"判断",module:"模块",database:"数据库",table:"数据表",file:"文件",sql:"SQL",llm:"大模型",tool_call:"工具调用",retrieval:"检索",rerank:"重排",assemble:"组装",api:"外部接口",embedding:"向量化",cache:"缓存",queue:"消息队列",prompt:"提示词",agent:"Agent",human_loop:"人工审核",checkpoint:"存档点"};
var STATE_ORDER=["completed","in_progress","planned","broken","to_plan","pending_decision","deprecated"];

function esc(s){return String(s==null?"":s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split(String.fromCharCode(34)).join("&quot;");}
function vlen(s){var n=0;if(!s)return 0;for(var i=0;i<s.length;i++){n+=s.charCodeAt(i)>0x2e80?1.7:1;}return n;}
function darkText(hex){var r=parseInt(hex.substr(1,2),16),g=parseInt(hex.substr(3,2),16),b=parseInt(hex.substr(5,2),16);return (r*299+g*587+b*114)/1000<150;}

var MODS={};
DATA.modules.forEach(function(m){var idx={};m.nodes.forEach(function(n){idx[n.id]=n;});m.nodesById=idx;MODS[m.id]=m;});
var cur="0",stack=[];
var svg=document.getElementById("cv"),vp=document.getElementById("vp");
var vb={x:0,y:0,w:1000,h:600};
var panning=false,panStart=null,drag=null;

function mod(){return MODS[cur];}
function nodeById(id){return mod()?mod().nodesById[id]:null;}

function applyVb(){svg.setAttribute("viewBox",vb.x+" "+vb.y+" "+vb.w+" "+vb.h);}
function svgPoint(ev){var r=svg.getBoundingClientRect();var sc=vb.w/r.width;return{x:vb.x+(ev.clientX-r.left)*sc,y:vb.y+(ev.clientY-r.top)*sc};}

function fit(){var m=mod();var vw=window.innerWidth,vh=window.innerHeight;var mw=Math.max(m.width,300),mh=Math.max(m.height,300);var pad=70;var sc=Math.min(vw/(mw+pad*2),vh/(mh+pad*2),1.4);vb.w=vw/sc;vb.h=vh/sc;vb.x=(mw-vb.w)/2;vb.y=(mh-vb.h)/2;applyVb();}

function border(a,b){var dx=b.x-a.x,dy=b.y-a.y;var hw=a.w/2,hh=a.h/2;if(dx===0&&dy===0)return{x:a.x,y:a.y};var sx=dx!==0?hw/Math.abs(dx):1e9;var sy=dy!==0?hh/Math.abs(dy):1e9;var s=Math.min(sx,sy);return{x:a.x+dx*s,y:a.y+dy*s};}

function pill(x,y,text,color,eid){var w=vlen(text)*12+18,h=21;var g='<g'+(eid?' data-pill="'+esc(eid)+'"':'')+'><rect x="'+(x-w/2)+'" y="'+(y-h/2)+'" width="'+w+'" height="'+h+'" rx="10" fill="#fff" stroke="'+color+'"/><text x="'+x+'" y="'+(y+4)+'" text-anchor="middle" font-size="12" fill="#374151">'+esc(text)+"</text></g>";return g;}

function edgeSvg(e){var a=nodeById(e.from),b=nodeById(e.to);if(!a||!b)return"";var p1=border(a,b),p2=border(b,a);var color=e.state?COLORS[e.state]:"#8a93a3";var mk=e.state?("arr-"+e.state):"arr-default";var g='<g class="edge" data-id="'+esc(e.id)+'"><line x1="'+p1.x+'" y1="'+p1.y+'" x2="'+p2.x+'" y2="'+p2.y+'" stroke="'+color+'" stroke-width="1.7" marker-end="url(#'+mk+')"/><title>'+esc((e.text?e.text+" ":"")+(e.description||""))+"</title>";
if(e.text){g+=pill((p1.x+p2.x)/2,(p1.y+p2.y)/2,e.text,color,e.id);}
g+="</g>";return g;}

function dbLink(n){var db=nodeById(n.dbNodeId);if(!db)return"";var p1=border(db,n),p2=border(n,db);return '<line data-dblink="'+esc(n.id)+'" x1="'+p1.x+'" y1="'+p1.y+'" x2="'+p2.x+'" y2="'+p2.y+'" stroke="#b6bdc9" stroke-width="1.3" stroke-dasharray="5 4"/>';}

function redrawConnected(n){var m=mod();
m.edges.forEach(function(e){if(e.from!==n.id&&e.to!==n.id)return;var a=nodeById(e.from),b=nodeById(e.to);if(!a||!b)return;
var p1=border(a,b),p2=border(b,a);var ln=vp.querySelector('g.edge[data-id="'+e.id+'"] line');
if(ln){ln.setAttribute("x1",p1.x);ln.setAttribute("y1",p1.y);ln.setAttribute("x2",p2.x);ln.setAttribute("y2",p2.y);}
if(e.text){var pg=vp.querySelector('g[data-pill="'+e.id+'"]');if(pg){pg.outerHTML=pill((p1.x+p2.x)/2,(p1.y+p2.y)/2,e.text,e.state?COLORS[e.state]:"#8a93a3",e.id);}}});
var dl=vp.querySelector('line[data-dblink="'+n.id+'"]');
if(dl&&n.dbNodeId){var db=nodeById(n.dbNodeId);if(db){var q1=border(db,n),q2=border(n,db);dl.setAttribute("x1",q1.x);dl.setAttribute("y1",q1.y);dl.setAttribute("x2",q2.x);dl.setAttribute("y2",q2.y);}}}

function nodeSvg(n){var fill=COLORS[n.state]||"#959da5";var tc=darkText(fill)?"#1f2430":"#ffffff";var stroke="rgba(20,30,50,0.28)";var w=n.w,h=n.h;
var g='<g class="node" data-id="'+esc(n.id)+'" transform="translate('+(n.x-w/2)+','+(n.y-h/2)+')">';
g+='<title>'+esc(n.name)+(n.description?" — "+esc(n.description):"")+"</title>";
if(n.type==="start"||n.type==="end"){g+='<rect class="body" width="'+w+'" height="'+h+'" rx="'+(h/2)+'" fill="'+fill+'" stroke="'+stroke+'"/>';return finishNode(g,n,tc,false,true);}
else if(n.type==="judge"){g+='<polygon class="body" points="'+(w/2)+',0 '+w+","+(h/2)+" "+(w/2)+","+h+" 0,"+(h/2)+'" fill="'+fill+'" stroke="'+stroke+'"/>';return finishNode(g,n,tc,false,true);}
else if(n.type==="database"){var e=11;g+='<path class="body" d="M0,'+e+" L"+w+","+(e)+" L"+w+","+(h-e)+" A"+(w/2)+","+e+' 0 0 1 0,'+(h-e)+' Z" fill="'+fill+'" stroke="'+stroke+'"/><ellipse cx="'+(w/2)+'" cy="'+e+'" rx="'+(w/2)+'" ry="'+e+'" fill="'+fill+'" stroke="'+stroke+'"/>';return finishNode(g,n,tc,false,true);}
else if(n.type==="table"){g+='<rect class="body" width="'+w+'" height="'+h+'" rx="8" fill="#ffffff" stroke="'+fill+'" stroke-width="1.6"/>';g+='<rect x="1" y="1" width="'+(w-2)+'" height="26" rx="7" fill="'+fill+'"/>';g+='<text x="10" y="18" font-size="12" font-weight="600" fill="'+tc+'">'+esc(n.name)+"</text>";
var fs=(n.fields||[]).slice(0,6);for(var i=0;i<fs.length;i++){var f=fs[i];g+='<text x="10" y="'+(42+i*17)+'" font-size="11" fill="#374151">'+esc(f.name)+(f.type?": "+esc(f.type):"")+"</text>";}
if((n.fields||[]).length>6){g+='<text x="10" y="'+(42+6*17)+'" font-size="11" fill="#8a93a3">…还有 '+(n.fields.length-6)+" 个字段</text>";}
return finishNode(g,n,tc,false,false);}
else if(n.type==="sql"){g+='<rect class="body" width="'+w+'" height="'+h+'" rx="8" fill="'+fill+'" stroke="'+stroke+'"/>';return finishNode(g,n,tc,false,true);}
else if(PORTED[n.type]){g+='<rect class="body" width="'+w+'" height="'+h+'" rx="10" fill="'+fill+'" stroke="'+stroke+'" stroke-width="2.2"/>';return finishNode(g,n,tc,true,false);}
else{g+='<rect class="body" width="'+w+'" height="'+h+'" rx="8" fill="'+fill+'" stroke="'+stroke+'"/>';return finishNode(g,n,tc,false,true);}}

function finishNode(g,n,tc,ported,withName){
if(ported){g+='<text x="'+(n.w/2)+'" y="21" text-anchor="middle" font-size="13" font-weight="600" fill="'+tc+'">'+esc(n.name)+"</text>";
var ins=n.inputs||[],outs=n.outputs||[],rows=Math.max(ins.length,outs.length,1);
for(var i=0;i<rows;i++){var y=38+i*18;
if(i<ins.length){g+='<circle cx="0" cy="'+y+'" r="3.2" fill="#fff" fill-opacity="0.9"/><text x="9" y="'+(y+4)+'" font-size="11" fill="'+tc+'" fill-opacity="0.92">'+esc(ins[i])+"</text>";}
if(i<outs.length){g+='<circle cx="'+n.w+'" cy="'+y+'" r="3.2" fill="#fff" fill-opacity="0.9"/><text x="'+(n.w-9)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="'+tc+'" fill-opacity="0.92">'+esc(outs[i])+"</text>";}
}}
else if(withName){g+='<text x="'+(n.w/2)+'" y="'+(n.h/2+4.5)+'" text-anchor="middle" font-size="13" font-weight="600" fill="'+tc+'">'+esc(n.name)+"</text>";}
g+="</g>";return g;}

function paintModule(){var m=mod();var es="",ns="";
m.edges.forEach(function(e){es+=edgeSvg(e);});
m.nodes.forEach(function(n){if((n.type==="table"||n.type==="sql")&&n.dbNodeId&&m.nodesById[n.dbNodeId]){es+=dbLink(n);}});
m.nodes.forEach(function(n){ns+=nodeSvg(n);});
vp.innerHTML="<g>"+es+"</g><g>"+ns+"</g>";}
function renderModule(mid){if(!MODS[mid])return;cur=mid;paintModule();fit();renderTop();renderStats();hideDetail();}
function redrawOnly(){paintModule();renderStats();}

function renderTop(){var m=mod();var h='<a data-go="root">'+esc(DATA.project)+"</a>";
stack.forEach(function(mid){h+='<span class="sep">/</span><a data-go="'+mid+'">'+esc(MODS[mid].name)+"</a>";});
h+='<span class="sep">/</span><span class="cur">'+esc(m.name)+"</span>";
document.getElementById("crumb").innerHTML=h;}

function renderStats(){var m=mod();var cnt={};STATE_ORDER.forEach(function(s){cnt[s]=0;});
m.nodes.forEach(function(n){cnt[n.state]=(cnt[n.state]||0)+1;});
var totalAll=0;DATA.modules.forEach(function(mm){totalAll+=mm.nodes.length;});
var h='<span>节点 '+m.nodes.length+"/"+totalAll+"</span>";
STATE_ORDER.forEach(function(s){if(cnt[s]>0){h+='<span><span class="dot" style="background:'+COLORS[s]+'"></span>'+LABELS[s]+" "+cnt[s]+"</span>";}});
document.getElementById("stats").innerHTML=h;}

function stateBadge(s){return '<span class="badge" style="background:'+COLORS[s]+'">'+LABELS[s]+"</span>";}
function row(k,v){return '<div class="row"><span class="k">'+k+'</span><span class="val">'+v+"</span></div>";}

function showDetail(n){var d=document.getElementById("detail");var h='<span class="close" data-close="1">×</span><h3>'+esc(n.name)+"</h3><div>"+stateBadge(n.state)+" <span style='color:#8a93a3;font-size:12px;margin-left:6px'>"+esc(TYPE_NAMES[n.type]||n.type)+"</span></div>";
h+=row("位置",n.location?'<span class="loc">'+esc(n.location)+'</span><span class="copy" data-copy="'+esc(n.location)+'">复制</span>':"<span style='color:#b6bdc9'>未填写</span>");
h+=row("说明",n.description?esc(n.description):"<span style='color:#b6bdc9'>未填写</span>");
if(n.target&&MODS[n.target])h+=row("子图",'<a class="copy" data-open="'+esc(n.target)+'">进入 '+esc(MODS[n.target].name)+" →</a>");
if(n.inputs&&n.inputs.length)h+=row("输入",esc(n.inputs.join("、")));
if(n.outputs&&n.outputs.length)h+=row("输出",esc(n.outputs.join("、")));
if(n.fields&&n.fields.length){h+='<div class="row"><span class="k">字段</span></div><pre>';n.fields.forEach(function(f){h+=esc(f.name)+(f.type?"  "+f.type:"")+(f.desc?"  // "+f.desc:"")+NL;});h+="</pre>";}
if(n.sql)h+=row("SQL","<pre>"+esc(n.sql)+"</pre>");
d.innerHTML=h;d.style.display="block";}

function showEdgeDetail(e){var d=document.getElementById("detail");var a=nodeById(e.from),b=nodeById(e.to);
var h='<span class="close" data-close="1">×</span><h3>连线：'+esc(a?a.name:e.from)+" → "+esc(b?b.name:e.to)+"</h3>";
if(e.state)h+=row("状态",stateBadge(e.state));
h+=row("文字",e.text?esc(e.text):"<span style='color:#b6bdc9'>无</span>");
h+=row("说明",e.description?esc(e.description):"<span style='color:#b6bdc9'>未填写</span>");
if(e.location)h+=row("位置",'<span class="loc">'+esc(e.location)+"</span>");
d.innerHTML=h;d.style.display="block";}

function hideDetail(){document.getElementById("detail").style.display="none";}
var toastTimer=null;
function toast(msg){var t=document.getElementById("toast");t.textContent=msg;t.style.opacity="1";if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.style.opacity="0";},1400);}

svg.addEventListener("wheel",function(ev){ev.preventDefault();var f=ev.deltaY<0?1/1.15:1.15;var p=svgPoint(ev);vb.x=p.x-(p.x-vb.x)*f;vb.y=p.y-(p.y-vb.y)*f;vb.w*=f;vb.h*=f;applyVb();},{passive:false});

svg.addEventListener("contextmenu",function(ev){ev.preventDefault();});

svg.addEventListener("pointerdown",function(ev){if(ev.button!==0)return;var ng=ev.target.closest?ev.target.closest("g.node"):null;
if(ng){var n=nodeById(ng.getAttribute("data-id"));if(n){drag={g:ng,n:n,sx:ev.clientX,sy:ev.clientY,ox:n.x,oy:n.y,moved:false};return;}}
panning=true;panStart={x:ev.clientX,y:ev.clientY,vx:vb.x,vy:vb.y};svg.classList.add("panning");});
window.addEventListener("pointermove",function(ev){
if(drag){var r=svg.getBoundingClientRect();var sc=vb.w/r.width;var dx=(ev.clientX-drag.sx)*sc,dy=(ev.clientY-drag.sy)*sc;
if(Math.abs(ev.clientX-drag.sx)+Math.abs(ev.clientY-drag.sy)>4)drag.moved=true;
if(drag.moved){drag.n.x=drag.ox+dx;drag.n.y=drag.oy+dy;drag.g.setAttribute("transform","translate("+(drag.n.x-drag.n.w/2)+','+(drag.n.y-drag.n.h/2)+")");drag.g.classList.add("dragged");redrawConnected(drag.n);}return;}
if(panning&&panStart){var r2=svg.getBoundingClientRect();var sc2=vb.w/r2.width;vb.x=panStart.vx-(ev.clientX-panStart.x)*sc2;vb.y=panStart.vy-(ev.clientY-panStart.y)*sc2;applyVb();}});
window.addEventListener("pointerup",function(ev){if(panning){panning=false;panStart=null;svg.classList.remove("panning");}if(drag&&ev.button===0){if(drag.moved)redrawOnly();setTimeout(function(){drag=null;},0);}});

document.addEventListener("click",function(ev){
if(!ev.target||!ev.target.closest)return;
var ind=ev.target.closest("#detail");
if(ind&&!ev.target.closest("[data-close]")&&!ev.target.closest("[data-copy]")&&!ev.target.closest("[data-open]"))return;
var cp=ev.target.closest("[data-copy]");
if(cp){var txt=cp.getAttribute("data-copy");
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){toast("已复制："+txt);},function(){toast("复制失败，请手动选择文本");});}
else{toast("浏览器不支持一键复制，请手动选择");}return;}
var op=ev.target.closest("[data-open]");
if(op){if(stack.indexOf(cur)<0)stack.push(cur);renderModule(op.getAttribute("data-open"));return;}
var go=ev.target.closest("[data-go]");
if(go){var dest=go.getAttribute("data-go");
if(dest==="root"){stack=[];}else{var idx=stack.indexOf(dest);if(idx>=0)stack=stack.slice(0,idx);}
renderModule(dest==="root"?"0":dest);return;}
if(ev.target.closest("[data-close]")){hideDetail();return;}
var ng=ev.target.closest("g.node");
if(ng){if(drag&&drag.moved)return;var n=nodeById(ng.getAttribute("data-id"));if(n){showDetail(n);return;}}
var eg=ev.target.closest("g.edge");
if(eg){var m=mod();var e=null;m.edges.forEach(function(x){if(x.id===eg.getAttribute("data-id"))e=x;});if(e){showEdgeDetail(e);return;}}
hideDetail();});

svg.addEventListener("dblclick",function(ev){if(!ev.target||!ev.target.closest)return;var ng=ev.target.closest("g.node");if(!ng)return;var n=nodeById(ng.getAttribute("data-id"));
if(n&&n.type==="module"&&n.target&&MODS[n.target]){if(stack.indexOf(cur)<0)stack.push(cur);renderModule(n.target);}});

document.getElementById("fitbtn").addEventListener("click",function(){fit();});

(function initLegend(){var h="";STATE_ORDER.forEach(function(s){h+='<span><span class="dot" style="background:'+COLORS[s]+'"></span>'+LABELS[s]+"</span>";});document.getElementById("legend").innerHTML=h;})();

renderModule("0");
`;

const HTML_HEAD = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__PROJECT__ - 项目流程图</title>
<style>${CSS}</style>
</head>
<body>
<svg id="cv" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arr-default" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1 L7 4 L1 7 Z" fill="#8a93a3"/></marker>
__MARKERS__
  </defs>
  <g id="vp"></g>
</svg>
<div id="topbar">
  <div id="crumb" class="panel"></div>
  <div id="rightbar">
    <div id="hint" class="panel">滚轮缩放 · 拖拽平移 · 点节点看详情 · 双击模块进子图 · 拖节点仅本次有效</div>
    <button id="fitbtn">适应画布</button>
    <div id="stats" class="panel"></div>
  </div>
</div>
<div id="legend" class="panel"></div>
<div id="detail"></div>
<div id="toast"></div>
<script>
`;

interface VNode {
  id: string;
  type: string;
  name: string;
  description: string;
  location: string;
  state: string;
  inputs?: string[];
  outputs?: string[];
  target?: string;
  dbNodeId?: string;
  fields?: { name: string; type?: string; desc?: string }[];
  sql?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface VEdge {
  id: string;
  from: string;
  to: string;
  text?: string;
  description?: string;
  state?: string;
}

function buildViewData(graph: FlowGraph, layout: LayoutResult) {
  return {
    project: graph.project,
    modules: Object.values(graph.modules).map((m) => {
      const lay = layout.modules[m.id];
      const nodes: VNode[] = Object.values(m.nodes).map((n) => {
        const box = lay?.nodes[n.id] ?? { x: 0, y: 0, w: 120, h: 52 };
        const v: VNode = {
          id: n.id,
          type: n.type,
          name: n.name,
          description: n.description,
          location: n.location,
          state: n.state,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
        };
        if (n.inputs?.length) v.inputs = n.inputs;
        if (n.outputs?.length) v.outputs = n.outputs;
        if (n.target) v.target = n.target;
        if (n.dbNodeId) v.dbNodeId = n.dbNodeId;
        if (n.fields?.length) v.fields = n.fields;
        if (n.sql) v.sql = n.sql;
        return v;
      });
      const edges: VEdge[] = Object.values(m.edges).map((e) => {
        const v: VEdge = { id: e.id, from: e.from, to: e.to };
        if (e.text) v.text = e.text;
        if (e.description) v.description = e.description;
        if (e.state) v.state = e.state;
        return v;
      });
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        width: lay?.width ?? 800,
        height: lay?.height ?? 600,
        nodes,
        edges,
      };
    }),
  };
}

export function renderHtml(graph: FlowGraph, layout: LayoutResult): string {
  // 每种状态一个箭头 marker
  const markers = Object.entries(STATE_COLORS)
    .map(
      ([state, color]) =>
        `<marker id="arr-${state}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1 L7 4 L1 7 Z" fill="${color}"/></marker>`,
    )
    .join("\n");

  const data = buildViewData(graph, layout);
  // 防止数据里出现 </script> 提前闭合脚本
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = graph.project.replace(/[<>&"]/g, "");

  return HTML_HEAD.replace("__PROJECT__", title).replace("__MARKERS__", markers) + "var DATA=" + json + ";\n" + VIEWER_JS + "</script>\n</body>\n</html>\n";
}
