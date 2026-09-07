import { evaluateLine, lineAreaM2, summariseLimits, hasLimits } from '../src/lib/productLimits.js';

// The real Verosol P201.0 Duo Pleated Blind sheet, transcribed.
const doc = {
  id: 'd1', title: 'Duo Pleated Blind', supplier: 'Verosol',
  limits: {
    widthMm: { min: 300, max: 3400 },
    dropMm:  { min: 200, max: 3200 },
    maxAreaM2: 10,
    checks: [
      { severity: 'error', when: { spec: 'control', is: 'Cord Lock' },
        widthMm: { max: 2900 }, message: 'Cord lock is limited to 2900mm wide' },
      { severity: 'warning', widthMm: { over: 2200 },
        message: 'Over 2200mm the fabric is joined with an overlap in the centre — tell the customer.' },
    ],
  },
};

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const sev = (line) => evaluateLine(line, [doc]).map(r => `${r.severity}:${r.field}`);
const txt = (line) => evaluateLine(line, [doc]).map(r => r.text);

t('in range, nothing',            sev({ widthMm: '1800', dropMm: '2400' }), []);
t('over max width',               sev({ widthMm: '3600', dropMm: '2400' }), ['error:width', 'warning:width']);
t('over width message',           txt({ widthMm: '3600', dropMm: '1000' })[0], 'Width 3600mm is over the 3400mm maximum');
t('under min width',              sev({ widthMm: '250',  dropMm: '1000' }), ['error:width']);
t('over max drop',                sev({ widthMm: '1000', dropMm: '3500' }), ['error:drop']);
t('area over 10m2',               sev({ widthMm: '3300', dropMm: '3150' }), ['error:area', 'warning:width']);
t('fabric join warning only',     sev({ widthMm: '2400', dropMm: '1500' }), ['warning:width']);
t('2200 exactly = no warning',    sev({ widthMm: '2200', dropMm: '1500' }), []);
t('cord lock over 2900',          sev({ widthMm: '3000', dropMm: '1000', control: 'Cord Lock' }), ['error:width', 'warning:width']);
t('cord lock message',            txt({ widthMm: '3000', dropMm: '1000', control: 'Cord Lock' })[0], 'Cord lock is limited to 2900mm wide');
t('other control, no cord rule',  sev({ widthMm: '3000', dropMm: '1000', control: 'Left' }), ['warning:width']);
t('condition is case-insensitive',sev({ widthMm: '3000', dropMm: '1000', control: 'cord lock' }), ['error:width', 'warning:width']);
t('blank line, silent',           sev({ widthMm: '', dropMm: '' }), []);
t('width only still checks',      sev({ widthMm: '3600', dropMm: '' }), ['error:width', 'warning:width']);
t('no docs, silent',              evaluateLine({ widthMm: '9999' }, []), []);
t('doc without limits, silent',   evaluateLine({ widthMm: '9999' }, [{ id: 'x', title: 'y' }]), []);
t('errors sort before warnings',  evaluateLine({ widthMm: '3600' }, [doc]).map(r => r.severity), ['error', 'warning']);
t('duplicate docs say it once',   evaluateLine({ widthMm: '3600' }, [doc, { ...doc, id: 'd2' }]).length, 2);
t('area helper',                  lineAreaM2(2000, 2500), 5);
t('summary line',                 summariseLimits(doc.limits), 'W 300–3400mm · D 200–3200mm · ≤10m² · 2 rules');
t('hasLimits true',               hasLimits(doc.limits), true);
t('hasLimits false',              hasLimits({ widthMm: {} }), false);
t('non-numeric junk ignored',     sev({ widthMm: 'abc', dropMm: '2400' }), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
