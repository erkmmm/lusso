import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlanPages, loadProjectPlans } from '../mac-assistant/plans.mjs';
import { makeQuotingPrompt } from '../mac-assistant/prompt.mjs';
function pdf(text) {
 const content=`BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let data='%PDF-1.4\n',offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(data);data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(data);
}
test('plan text keeps source page numbers and stated ceiling dimensions',async()=>{
 const result=await extractPlanPages(pdf('DINING CEILING HEIGHT 3000 mm'));
 assert.equal(result.pageCount,1);assert.equal(result.pages[0].page,1);assert.ok(result.pages[0].text.includes('3000 mm'));assert.equal(result.pages[0].truncated,false);
});
test('private plans from another project are never downloaded; missing PDFs are explicit',async()=>{
 let downloads=0;
 const result=await loadProjectPlans([{file_path:'other/plan.pdf',file_name:'Wrong plan'},{file_path:'j/plan.pdf',file_name:'Missing plan'}],{jobId:'j',download:async()=>{downloads++;throw new Error('Not available');}});
 assert.equal(downloads,1);assert.ok(result[0].error.includes('does not belong'));assert.equal(result[1].error,'Not available');
});
test('the quoting prompt reads uploaded plans before requesting drops and preserves uncertainty',()=>{
 const prompt=makeQuotingPrompt({job:{id:'j'},customer:{name:'Client'},sheet:{id:'s'},quotes:[],supplierGuides:'',plans:[{fileName:'Sections.pdf',pages:[{page:3,text:'CEILING 3000'}]}]});
 for(const text of ['Sections.pdf','CEILING 3000','Before asking the user','stepped floors','provisional plan allowance','settings?section=curtains','do not add that making again']) assert.ok(prompt.includes(text),text);
});
