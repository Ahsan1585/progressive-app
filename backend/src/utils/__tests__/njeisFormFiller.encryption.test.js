process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

const fs = require('fs');
const path = require('path');
const { PDFTextField } = require('pdf-lib');
const { encryptField, decryptAssessmentRow } = require('../fieldEncryption');
const { buildNjeisPdfForGroup } = require('../njeisFormFiller');

describe('buildNjeisPdfForGroup with an encrypted-at-rest patient_dob', () => {
  // The template form is flattened to static page content inside
  // buildNjeisPdfForGroup, so the DOB value isn't retrievable as a form
  // field afterward — this project has no PDF text-extraction library to
  // read it back off the rendered page either. Spying on the one seam that
  // actually carries the value, PDFTextField.setText, proves the full
  // pipeline (ciphertext -> decryptAssessmentRow -> buildNjeisPdfForGroup's
  // PDF write) produces the correct decrypted date, not ciphertext or a
  // crash from `pData.patient_dob.split('-')` on an undecrypted string.
  it('renders the correct, decrypted DOB on the generated NJEIS PDF, not ciphertext or a crash', async () => {
    const templatePath = path.join(__dirname, '..', '..', '..', 'templates', 'NJEIS-020.pdf');
    const templateBytes = fs.readFileSync(templatePath);

    const encryptedRow = {
      id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
      patient_dob: encryptField('2024-03-05'), patient_county: 'Essex',
      practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', practitioner_discipline: 'PT',
      service_date: '2026-10-29', start_time: '10:00', end_time: '11:00', total_time: 60,
      type: 'PT', location: '1', status: '1',
    };
    const decryptedRecord = decryptAssessmentRow(encryptedRow);

    const setTextCalls = [];
    const originalSetText = PDFTextField.prototype.setText;
    PDFTextField.prototype.setText = function setTextSpy(text) {
      setTextCalls.push({ name: this.getName(), text });
      return originalSetText.call(this, text);
    };
    try {
      await buildNjeisPdfForGroup(templateBytes, [decryptedRecord], 'Test Agency', { first_name: 'Omar', last_name: 'Abernathy', position_title: 'PT' });
    } finally {
      PDFTextField.prototype.setText = originalSetText;
    }

    const dobCall = setTextCalls.find((c) => c.name === 'DOB');
    expect(dobCall).toBeDefined();
    expect(dobCall.text).not.toContain('v1:');
    expect(dobCall.text).toBe('3/5/2024');
  });
});
