const assert=require('assert');
const R=6371000,rad=Math.PI/180;
function dist(a,b){const p1=a.lat*rad,p2=b.lat*rad,dp=(b.lat-a.lat)*rad,dl=(b.lng-a.lng)*rad;const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
function bearing(a,b){const p1=a.lat*rad,p2=b.lat*rad,dl=(b.lng-a.lng)*rad;return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360;}
function mismatch(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
function project(path,lat,lon,center,speedKmh){const cum=[0];for(let i=1;i<path.length;i++)cum[i]=cum[i-1]+dist(path[i-1],path[i]);const total=cum.at(-1),speed=speedKmh/3.6,lo=center==null?0:Math.max(0,center-Math.max(70,speed*4+35)),hi=center==null?Math.min(total,700):Math.min(total,center+Math.max(320,speed*14+200));const cos=Math.max(.15,Math.cos(lat*rad));let best=null,bestScore=Infinity;for(let i=1;i<path.length;i++){if(cum[i]<lo||cum[i-1]>hi)continue;const a=path[i-1],b=path[i],ax=(a.lng-lon)*rad*cos*R,ay=(a.lat-lat)*rad*R,bx=(b.lng-lon)*rad*cos*R,by=(b.lat-lat)*rad*R,dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;let u=den?-(ax*dx+ay*dy)/den:0;u=Math.max(0,Math.min(1,u));const x=ax+u*dx,y=ay+u*dy,d=Math.hypot(x,y),s=cum[i-1]+(cum[i]-cum[i-1])*u,score=d+(center!=null&&s<center-10?(center-10-s)*.6:0);if(score<bestScore){bestScore=score;best={d,s};}}return best;}
// Synthetic route: first 1 km east, long detour, then a segment geometrically near the start again around 7.5 km progress.
const path=[];for(let i=0;i<=10;i++)path.push({lat:34,lng:135+i*.0011});for(let i=1;i<=60;i++)path.push({lat:34+i*.0007,lng:135.011});for(let i=1;i<=60;i++)path.push({lat:34.042,lng:135.011-i*.00018});for(let i=1;i<=60;i++)path.push({lat:34.042-i*.0007,lng:135.0002});
const p=project(path,34,135.0085,775,35);assert(p,'local projection exists');assert(p.s<1600,`far-ahead steal blocked: ${p.s}`);
// Reroute evidence: 2 fixes + >=650ms or hard-far should trigger; one noisy fix should not.
function reroute(seq){let fixes=0,since=0;for(const e of seq){if(e.off){if(!since)since=e.t;fixes++;const ready=(e.hard&&fixes>=2)||(fixes>=2&&e.t-since>=650);if(ready)return true;}else{fixes=Math.max(0,fixes-1);if(!fixes)since=0;}}return false;}
assert.equal(reroute([{t:1000,off:true,hard:false},{t:1200,off:false,hard:false}]),false);
assert.equal(reroute([{t:1000,off:true,hard:false},{t:1700,off:true,hard:false}]),true);
assert.equal(reroute([{t:1000,off:true,hard:true},{t:1150,off:true,hard:true}]),true);
// Rejoin policy requires 3 consecutive aligned fixes.
function rejoin(flags){let n=0;for(const f of flags){n=f?n+1:0;if(n>=3)return true;}return false;}
assert.equal(rejoin([true,true,false,true,true]),false);assert.equal(rejoin([false,true,true,true]),true);
console.log('V615_CORE_SIM_OK');
