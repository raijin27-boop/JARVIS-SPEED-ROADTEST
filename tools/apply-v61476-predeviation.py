from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""    // v6.14.55: a single noisy fix must not visibly flip the rider-facing state to OFF_ROUTE —
    // require the same 2-fix minimum the escape/reroute decisions below already use. Before that,
    // the state stays whatever it already was (very often just GPS noise that resolves on the
    // next fix); the counters above still accumulate so a genuine departure is not delayed.
    const confirmFixes=decisiveHeading?3:4;
    if(autoRerouteOffRouteFixes>=confirmFixes)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=decisiveHeading?1400:(headingWrong?1900:2600);
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=confirmFixes&&held>=escapeHold)
      jarvisEnterDeviationEscape((headingWrong||decisiveHeading)?'HEADING':'OFF_ROUTE');

    const fastReady=(hardFar||decisiveHeading||headingWrong)&&autoRerouteOffRouteFixes>=5&&held>=3000;
    const steadyReady=autoRerouteOffRouteFixes>=6&&held>=4000;
    const rerouteReady=!settling&&(fastReady||steadyReady);
"""
new="""    // v6.14.76 PRE-DEVIATION DISPLAY: do not keep the rider ball frozen on the stale route
    // while we are still gathering enough evidence for a network reroute. Two consistent good-GPS
    // departure fixes may hand VISUAL ownership to free/GPS without declaring OFF_ROUTE yet.
    // This preserves false-reroute protection while making a real missed turn visible immediately.
    const preDeviationVisual=acc<=25&&speed>=8&&autoRerouteOffRouteFixes>=2&&
      (decisiveHeading||headingWrong||lateral>Math.max(22,threshold*.68));
    if(!jarvisDeviationEscape&&preDeviationVisual){
      jarvisVisualGpsPriority=true;
      jarvisVisualOnRouteFixes=0;
    }

    // v6.14.76: one stage earlier than v75, but still multi-fix. Strong heading disagreement
    // confirms after 2 fixes; ordinary sustained departure after 3.
    const confirmFixes=decisiveHeading?2:3;
    if(autoRerouteOffRouteFixes>=confirmFixes)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=decisiveHeading?850:(headingWrong?1200:1700);
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=confirmFixes&&held>=escapeHold)
      jarvisEnterDeviationEscape((headingWrong||decisiveHeading)?'HEADING':'OFF_ROUTE');

    const fastFixes=decisiveHeading?3:4;
    const fastHold=decisiveHeading?1600:(headingWrong?2200:2600);
    const fastReady=(hardFar||decisiveHeading||headingWrong)&&autoRerouteOffRouteFixes>=fastFixes&&held>=fastHold;
    const steadyReady=autoRerouteOffRouteFixes>=5&&held>=3200;
    const rerouteReady=!settling&&(fastReady||steadyReady);
"""
if old not in s: raise SystemExit('v75 confirmation block missing')
s=s.replace(old,new,1)
old2="""  }else if(lateral<8&&mismatch<35){
    jarvisNavTrackingState='TRACKING';
    if(!jarvisDeviationEscape)jarvisResetAutoRerouteWatch();
"""
new2="""  }else if(lateral<8&&mismatch<35){
    jarvisNavTrackingState='TRACKING';
    if(!jarvisDeviationEscape){
      // A pre-deviation visual handoff that resolves as noise/temporary geometry must return
      // cleanly to route rendering without waiting for a separate state machine.
      jarvisVisualGpsPriority=false;
      jarvisVisualOnRouteFixes=0;
      jarvisResetAutoRerouteWatch();
    }
"""
if old2 not in s: raise SystemExit('on-route recovery block missing')
s=s.replace(old2,new2,1)
s=s.replace("'v6.14.75-ROADTEST-dev'","'v6.14.76-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text()
t=t.replace('v6.14.75-ROADTEST-20260906T0210JST','v6.14.76-ROADTEST-20260906T0250JST')
t=t.replace('app.js?v=v6.14.75-0210','app.js?v=v6.14.76-0250')
t=t.replace('road-test-ui.js?v=v6.14.75-0210','road-test-ui.js?v=v6.14.76-0250')
idx.write_text(t)
