from pathlib import Path
p=Path('app.js')
s=p.read_text()
needle="let jarvisVisualOnRouteFixes=0;"
if needle not in s: raise SystemExit('visual counter anchor missing')
s=s.replace(needle,needle+"\nlet jarvisPreDeviationVisualFixes=0; // v6.14.77 early visual-only departure evidence",1)
old_reset="""function jarvisResetAutoRerouteWatch(){
  autoRerouteOffRouteSince=0;
  autoRerouteOffRouteFixes=0;
  if(!jarvisDeviationEscape)jarvisDeviationEvidence=0;
}
"""
new_reset="""function jarvisResetAutoRerouteWatch(){
  autoRerouteOffRouteSince=0;
  autoRerouteOffRouteFixes=0;
  jarvisPreDeviationVisualFixes=0;
  if(!jarvisDeviationEscape)jarvisDeviationEvidence=0;
}
"""
if old_reset not in s: raise SystemExit('reset function missing')
s=s.replace(old_reset,new_reset,1)
anchor="""  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(66,threshold+14);

  if(clearlyFar||headingWrong||decisiveHeading){
"""
insert="""  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(66,threshold+14);

  // v6.14.77 EARLY VISUAL RELEASE: this evidence is intentionally independent from the
  // OFF_ROUTE/reroute counter below. A rider who has physically turned away should not see the
  // ball frozen on the stale route while the safer reroute state machine keeps gathering proof.
  // With good GPS, require two consecutive visual-only departure fixes. A very strong heading
  // disagreement can count while still only ~10-15m away; otherwise require modest lateral drift.
  const visualDeparture=acc<=25&&speed>=8&&(
    (lateral>Math.max(12,acc*1.45)&&mismatch>48)||
    (lateral>Math.max(20,acc*2.0))
  );
  if(!jarvisDeviationEscape&&visualDeparture){
    jarvisPreDeviationVisualFixes++;
    if(jarvisPreDeviationVisualFixes>=2){
      jarvisVisualGpsPriority=true;
      jarvisVisualOnRouteFixes=0;
    }
  }else if(!jarvisDeviationEscape){
    jarvisPreDeviationVisualFixes=Math.max(0,jarvisPreDeviationVisualFixes-1);
  }

  if(clearlyFar||headingWrong||decisiveHeading){
"""
if anchor not in s: raise SystemExit('reroute branch anchor missing')
s=s.replace(anchor,insert,1)
# Remove v76 nested preDeviationVisual block to avoid duplicate/late ownership logic
old_nested="""    // v6.14.76 PRE-DEVIATION DISPLAY: do not keep the rider ball frozen on the stale route
    // while we are still gathering enough evidence for a network reroute. Two consistent good-GPS
    // departure fixes may hand VISUAL ownership to free/GPS without declaring OFF_ROUTE yet.
    // This preserves false-reroute protection while making a real missed turn visible immediately.
    const preDeviationVisual=acc<=25&&speed>=8&&autoRerouteOffRouteFixes>=2&&
      (decisiveHeading||headingWrong||lateral>Math.max(22,threshold*.68));
    if(!jarvisDeviationEscape&&preDeviationVisual){
      jarvisVisualGpsPriority=true;
      jarvisVisualOnRouteFixes=0;
    }

"""
if old_nested not in s: raise SystemExit('v76 nested visual block missing')
s=s.replace(old_nested,"",1)
s=s.replace("'v6.14.76-ROADTEST-dev'","'v6.14.77-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text()
t=t.replace('v6.14.76-ROADTEST-20260906T0250JST','v6.14.77-ROADTEST-20260906T0315JST')
t=t.replace('app.js?v=v6.14.76-0250','app.js?v=v6.14.77-0315')
t=t.replace('road-test-ui.js?v=v6.14.76-0250','road-test-ui.js?v=v6.14.77-0315')
idx.write_text(t)
