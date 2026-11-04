import {pageToView} from './planRotate.js';

/** Centre a marked opening with surrounding drawing context, including rotated sheets. */
export function openingFocusView(points,baseSize,rotation,viewport) {
  const valid=points.filter(p=>Number.isFinite(p.x) && Number.isFinite(p.y));
  if(!valid.length || !baseSize || viewport.width<80 || viewport.height<80)return null;
  const displayed=valid.map(p=>pageToView(p,rotation,baseSize));
  const xs=displayed.map(p=>p.x),ys=displayed.map(p=>p.y);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  const scale=Math.max(0.05,Math.min(1.5,(viewport.width-64)/Math.max(320,(right-left)*2.2),(viewport.height-64)/Math.max(240,(bottom-top)*2.2)));
  return {scale,tx:viewport.width/2-(left+right)/2*scale,ty:viewport.height/2-(top+bottom)/2*scale};
}
