from pathlib import Path
p=Path('app.js')
WAKE_B64='AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMUbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAj90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG3bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABYm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAAg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABYoAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALFAAAAAQAAABRzdGNvAAAAAAAAAAEAAANEAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2MS43LjEwMwAAAAhmcmVlAAACzW1kYXQAAAKtBgX//6ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABBliIQAFf/+98nvwKbr29+B'
s=p.read_text()
s=s.replace("if(!navSessionStarted||navMode!=='ROUTE'||jarvisDeviationEscape||jarvisVisualGpsPriority||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')return{lat,lng};","if(!navSessionStarted||navMode!=='ROUTE'||jarvisDeviationEscape||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')return{lat,lng};",1)
old="""  const maxSnap=Math.max(30,Math.min(58,28+acc*1.15));
  if(pr.distance>maxSnap)return{lat,lng};
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  let strength=pr.distance<=18?.985:pr.distance<=30?.94:pr.distance<=42?.82:.68;
  if(acc>28)strength=Math.min(strength,.80);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
"""
new="""  const maxSnap=Math.max(68,Math.min(92,64+acc*1.35));
  if(pr.distance>maxSnap)return{lat,lng};
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  // v6.14.66: consumer-nav hard adhesion. While TRACKING the cursor is ON the route.
  let strength=pr.distance<=45?1:pr.distance<=65?.985:.94;
  if(acc>35)strength=Math.min(strength,.92);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
"""
if old not in s: raise SystemExit('snap block missing')
s=s.replace(old,new,1)
s=s.replace("const visualThreshold=Math.max(VISUAL_ESCAPE_MIN_M,Math.min(22,acc*.72));","const visualThreshold=Math.max(58,Math.min(78,50+acc*1.35));",1)
s=s.replace("const departureHeadingMin=Math.max(VISUAL_ESCAPE_HEADING_DEG,50);","const departureHeadingMin=Math.max(VISUAL_ESCAPE_HEADING_DEG,82);",1)
s=s.replace("const departureIntent=jarvisDepartureFixes>=2;","const departureIntent=jarvisDepartureFixes>=4;",1)
old="""  const threshold=settling?Math.max(34,AUTO_REROUTE_DISTANCE_M):Math.max(24,Math.min(36,16+acc*.85));
  const headingWrong=speed>=8&&lateral>10&&mismatch>70;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(44,threshold+10);
"""
new="""  const threshold=settling?Math.max(68,AUTO_REROUTE_DISTANCE_M):Math.max(55,Math.min(72,46+acc*1.15));
  const headingWrong=speed>=10&&lateral>24&&mismatch>88;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(92,threshold+18);
"""
if old not in s: raise SystemExit('reroute threshold missing')
s=s.replace(old,new,1)
old="""    if(autoRerouteOffRouteFixes>=3)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=headingWrong?1200:1600;
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=3&&held>=escapeHold)
      jarvisEnterDeviationEscape(headingWrong?'HEADING':'OFF_ROUTE');

    // v6.14.65: reroute is deliberately slower than visual snapping. A genuine missed turn still
    // accumulates quickly, but ordinary GPS drift must persist for several fixes before a network
    // request is allowed.
    const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=4&&held>=2200;
    const steadyReady=autoRerouteOffRouteFixes>=5&&held>=3200;
"""
new="""    if(autoRerouteOffRouteFixes>=5)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=headingWrong?2800:3600;
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=5&&held>=escapeHold)
      jarvisEnterDeviationEscape(headingWrong?'HEADING':'OFF_ROUTE');

    const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=6&&held>=4200;
    const steadyReady=autoRerouteOffRouteFixes>=7&&held>=5200;
"""
if old not in s: raise SystemExit('reroute gate missing')
s=s.replace(old,new,1)
old="""    v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');
    v.style.cssText='position:fixed;width:2px;height:2px;left:-10px;top:-10px;opacity:.01;pointer-events:none;z-index:-1';
    document.body.appendChild(v);
    if(jarvisWakeCanvas.captureStream)v.srcObject=jarvisWakeCanvas.captureStream(1);
    jarvisWakeVideo=v;
"""
new=f"""    v.muted=true;v.playsInline=true;v.loop=true;v.preload='auto';v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');
    v.style.cssText='position:fixed;width:2px;height:2px;left:-10px;top:-10px;opacity:.01;pointer-events:none;z-index:-1';
    v.src='data:video/mp4;base64,{WAKE_B64}';
    document.body.appendChild(v);
    jarvisWakeVideo=v;
"""
if old not in s: raise SystemExit('wake video block missing')
s=s.replace(old,new,1)
s=s.replace("'v6.14.65-ROADTEST-dev'","'v6.14.66-ROADTEST-dev'")
p.write_text(s)
i=Path('index.html');t=i.read_text().replace('v6.14.65-ROADTEST-20260905T2320JST','v6.14.66-ROADTEST-20260905T2345JST');i.write_text(t)
