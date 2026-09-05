from pathlib import Path
p=Path('app.js')
s=p.read_text()
# 1) reroute-only seed flag
needle="let jarvisRouteSettleUntil=0;"
if needle not in s: raise SystemExit('route settle flag missing')
s=s.replace(needle,needle+"\nlet jarvisRerouteSeedPending=false; // v6.14.75 seed new reroute progress from live GPS",1)
# 2) slightly earlier but still multi-signal reroute corridor
old="""  const threshold=settling?Math.max(58,AUTO_REROUTE_DISTANCE_M):Math.max(42,Math.min(60,34+acc*1.05));
  const headingWrong=speed>=8&&lateral>14&&mismatch>78;
  const decisiveHeading=acc<=25&&speed>=10&&lateral>9&&mismatch>108;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(75,threshold+16);
"""
new="""  // v6.14.75 EARLIER REROUTE: good GPS + sustained directional disagreement may begin
  // departure confirmation before lateral error grows to 70-80m. Weak/slow GPS keeps the
  // existing wider corridor; this is deliberately not a one-fix distance trigger.
  const threshold=settling?Math.max(58,AUTO_REROUTE_DISTANCE_M):Math.max(36,Math.min(54,29+acc*.88));
  const headingWrong=speed>=8&&lateral>12&&mismatch>72;
  const decisiveHeading=acc<=22&&speed>=10&&lateral>8&&mismatch>102;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(66,threshold+14);
"""
if old not in s: raise SystemExit('v67 reroute threshold block missing')
s=s.replace(old,new,1)
# 3) set seed only for reroute commit
oldc="""  if(reason==='REROUTE'||reason==='ORIGINAL_ROUTE_REJOIN')jarvisRouteSettleUntil=routeLastAt+AUTO_REROUTE_SETTLE_MS;
  jarvisRoadTestNoteLifecycle('ROUTE_COMMITTED',{reason,generation:routeRequestSeq,candidateCount:candidates.length});
"""
newc="""  if(reason==='REROUTE'||reason==='ORIGINAL_ROUTE_REJOIN')jarvisRouteSettleUntil=routeLastAt+AUTO_REROUTE_SETTLE_MS;
  if(reason==='REROUTE')jarvisRerouteSeedPending=true;
  jarvisRoadTestNoteLifecycle('ROUTE_COMMITTED',{reason,generation:routeRequestSeq,candidateCount:candidates.length});
"""
if oldc not in s: raise SystemExit('route commit tail missing')
s=s.replace(oldc,newc,1)
# 4) initialize new path progress from live GPS only after reroute
oldp="""  jarvisMotion.total=cum[cum.length-1];
  jarvisMotion.targetS=null;
  jarvisMotion.displayS=null;
  jarvisMotion.lastProjection=null;
  return true;
}
"""
newp="""  jarvisMotion.total=cum[cum.length-1];
  jarvisMotion.targetS=null;
  jarvisMotion.displayS=null;
  jarvisMotion.lastProjection=null;
  // v6.14.75 REROUTE HANDOFF: a newly committed reroute must not visually restart at S=0.
  // Once the new path exists, project the latest RAW GPS onto it and seed both route-progress
  // values there. This is reroute-only; normal START initialization is unchanged.
  if(jarvisRerouteSeedPending&&Number.isFinite(currentLat)&&Number.isFinite(currentLon)){
    jarvisRerouteSeedPending=false;
    const seed=jarvisMotionProject(currentLat,currentLon,Number.isFinite(jarvisFreeMotion.accuracy)?jarvisFreeMotion.accuracy:15);
    if(seed&&Number.isFinite(seed.s)){
      const seedS=Math.max(0,Math.min(jarvisMotion.total,seed.s));
      jarvisMotion.targetS=seedS;
      jarvisMotion.displayS=seedS;
      jarvisMotion.lastProjection={s:seedS,distance:Number(seed.distance)||0};
    }
  }
  return true;
}
"""
if oldp not in s: raise SystemExit('motion prepare tail missing')
s=s.replace(oldp,newp,1)
s=s.replace("'v6.14.74-ROADTEST-dev'","'v6.14.75-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text()
t=t.replace('v6.14.74-ROADTEST-20260906T0150JST','v6.14.75-ROADTEST-20260906T0210JST')
t=t.replace('app.js?v=v6.14.74-0150','app.js?v=v6.14.75-0210')
t=t.replace('road-test-ui.js?v=v6.14.74-0150','road-test-ui.js?v=v6.14.75-0210')
idx.write_text(t)
