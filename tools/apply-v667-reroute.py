from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""  const threshold=settling?Math.max(68,AUTO_REROUTE_DISTANCE_M):Math.max(55,Math.min(72,46+acc*1.15));
  const headingWrong=speed>=10&&lateral>24&&mismatch>88;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(92,threshold+18);
"""
new="""  // v6.14.67 REROUTE: stronger real-deviation response without returning to one-fix triggers.
  // Good GPS may react sooner; weak GPS keeps a wider corridor. A missed turn can be confirmed
  // from strong heading disagreement before lateral distance grows to the old 55-72m threshold.
  const threshold=settling?Math.max(58,AUTO_REROUTE_DISTANCE_M):Math.max(42,Math.min(60,34+acc*1.05));
  const headingWrong=speed>=8&&lateral>14&&mismatch>78;
  const decisiveHeading=acc<=25&&speed>=10&&lateral>9&&mismatch>108;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(75,threshold+16);
"""
if old not in s: raise SystemExit('v66 reroute threshold block missing')
s=s.replace(old,new,1)
old2="""  if(clearlyFar||headingWrong){
"""
new2="""  if(clearlyFar||headingWrong||decisiveHeading){
"""
if old2 not in s: raise SystemExit('v66 reroute evidence gate missing')
s=s.replace(old2,new2,1)
old3="""    if(autoRerouteOffRouteFixes>=5)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=headingWrong?2800:3600;
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=5&&held>=escapeHold)
      jarvisEnterDeviationEscape(headingWrong?'HEADING':'OFF_ROUTE');

    const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=6&&held>=4200;
    const steadyReady=autoRerouteOffRouteFixes>=7&&held>=5200;
"""
new3="""    const confirmFixes=decisiveHeading?3:4;
    if(autoRerouteOffRouteFixes>=confirmFixes)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=decisiveHeading?1400:(headingWrong?1900:2600);
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=confirmFixes&&held>=escapeHold)
      jarvisEnterDeviationEscape((headingWrong||decisiveHeading)?'HEADING':'OFF_ROUTE');

    const fastReady=(hardFar||decisiveHeading||headingWrong)&&autoRerouteOffRouteFixes>=5&&held>=3000;
    const steadyReady=autoRerouteOffRouteFixes>=6&&held>=4000;
"""
if old3 not in s: raise SystemExit('v66 reroute confirmation block missing')
s=s.replace(old3,new3,1)
s=s.replace("'v6.14.66-ROADTEST-dev'","'v6.14.67-ROADTEST-dev'",1)
p.write_text(s)
i=Path('index.html')
t=i.read_text().replace('v6.14.66-ROADTEST-20260905T2345JST','v6.14.67-ROADTEST-20260906T0055JST',1)
i.write_text(t)
