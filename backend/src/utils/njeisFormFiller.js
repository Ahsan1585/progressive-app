// Fills the NJEIS-020 template with one group's session rows, producing a
// standalone PDFDocument (chunked 10 rows/page, same as the source this was
// extracted from). Extracted out of billingController.js's generateNJEISForms
// so both that function (which copies each returned page into one combined,
// multi-patient PDF) and generateSelfCertifiedSEVF (which saves each group's
// result as its own separate file) share the exact same fill/signature/
// county-overlay logic instead of two copies that could silently drift.
//
// `patientRecords` must already be ordered by service_date ASC and belong to
// exactly one (patient, [company_affiliation], [month]) group — this
// function has no opinion on grouping, it only renders whatever rows it's
// given. `companyName` is resolved by the caller (getCompanyName() for a
// tenant company, or a company_affiliation label for an independent
// practitioner — see billingController.js's generateSelfCertifiedSEVF).
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { formatTime12h } = require('./formatting');
const { getDisciplineCode } = require('./disciplineCodes');

async function buildNjeisPdfForGroup(templateBytes, patientRecords, companyName, practitioner) {
  const outDoc = await PDFDocument.create();

  for (let i = 0; i < patientRecords.length; i += 10) {
    const chunk = patientRecords.slice(i, i + 10);
    const pData = chunk[0];

    const tempDoc = await PDFDocument.load(templateBytes);
    const form = tempDoc.getForm();
    const setUniformText = (fieldName, text) => {
      try {
        const field = form.getTextField(fieldName);
        field.setText(text || '');
        field.setFontSize(10);
      } catch (e) { }
    };

    setUniformText('Service Provider Agency Name', companyName);
    setUniformText('Practitioner Last Name', pData.practitioner_last_name);
    setUniformText('Practitioner First Name', pData.practitioner_first_name);
    setUniformText('Childs Last Name', pData.patient_last_name);
    setUniformText('Childs First Name', pData.patient_first_name);
    if (pData.patient_dob) {
      const [by, bm, bd] = pData.patient_dob.split('-');
      setUniformText('DOB', `${parseInt(bm)}/${parseInt(bd)}/${by}`);
    } else {
      setUniformText('DOB', '');
    }
    const countyValue = pData.patients?.county || pData.patient_county || '';
    let countyRect = null;
    try {
      countyRect = form.getField('County').acroField.getWidgets()[0].getRectangle();
    } catch (e) {
      setUniformText('County', countyValue);
    }
    setUniformText('Child ID', pData.patients?.child_id || pData.patient_id?.toString());
    setUniformText('DisciplinePosition Title', getDisciplineCode(practitioner?.position_title));
    if (pData.service_date) {
      const [my, mm] = pData.service_date.split('-');
      setUniformText('MonthYear', `${mm}/${my}`);
    }

    chunk.forEach((session, index) => {
      const rowNum = index + 1;
      const [sy, sm, sd] = (session.service_date || '').split('-');
      setUniformText(`Service date${rowNum}`, session.service_date ? `${parseInt(sm)}/${parseInt(sd)}/${sy.slice(-2)}` : '');
      setUniformText(`Service StatusRow${rowNum}`, session.status?.toString());
      setUniformText(`Service TypeRow${rowNum}`, session.type);
      setUniformText(`Service LocationRow${rowNum}`, session.location?.toString());
      setUniformText(`Start TimeRow${rowNum}`, formatTime12h(session.start_time));
      setUniformText(`End TimeRow${rowNum}`, formatTime12h(session.end_time));
      setUniformText(`Total TimeRow${rowNum}`, session.total_time?.toString());
    });

    const chunkDates = chunk.map((s) => s.service_date).filter(Boolean).sort();
    const lastChunkDate = chunkDates[chunkDates.length - 1];
    setUniformText('Date', lastChunkDate
      ? new Date(`${lastChunkDate}T00:00:00`).toLocaleDateString()
      : new Date().toLocaleDateString());
    const pages = tempDoc.getPages();
    const firstPage = pages[0];

    if (pData.practitioner_signature) {
      try {
        const pracSigField = form.getTextField('Practitioner Signature');
        const rect = pracSigField.acroField.getWidgets()[0].getRectangle();
        const practSigImage = await tempDoc.embedPng(pData.practitioner_signature);
        const padding = 2;
        const maxW = rect.width - padding * 2;
        const maxH = rect.height - padding * 2;
        const scale = Math.min(maxW / practSigImage.width, maxH / practSigImage.height) * 1.5;
        const imgW = practSigImage.width * scale;
        const imgH = practSigImage.height * scale;
        const drawX = rect.x + (rect.width - imgW) / 2;
        const drawY = rect.y + (rect.height - imgH) / 2;
        firstPage.drawImage(practSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
        firstPage.drawImage(practSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
      } catch (e) { /* field not found */ }
    }
    for (let index = 0; index < chunk.length; index++) {
      const rowNum = index + 1;
      if (chunk[index].billing_status === 'rejected') {
        setUniformText(`ParentCaregiver Signature Verifying Services ReceivedRow${rowNum}`, 'REJECTED');
      } else if (chunk[index].parent_signature) {
        try {
          const sigField = form.getTextField(`ParentCaregiver Signature Verifying Services ReceivedRow${rowNum}`);
          const rect = sigField.acroField.getWidgets()[0].getRectangle();
          const parentSigImage = await tempDoc.embedPng(chunk[index].parent_signature);
          const padding = 2;
          const maxW = rect.width - padding * 2;
          const maxH = rect.height - padding * 2;
          const scale = Math.min(maxW / parentSigImage.width, maxH / parentSigImage.height) * 1.5;
          const imgW = parentSigImage.width * scale;
          const imgH = parentSigImage.height * scale;
          const drawX = rect.x + (rect.width - imgW) / 2;
          const drawY = rect.y + (rect.height - imgH) / 2;
          firstPage.drawImage(parentSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
          firstPage.drawImage(parentSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
        } catch (e) { /* field not found for this row */ }
      }
    }
    form.flatten();

    if (countyRect && countyValue) {
      const helvetica = await tempDoc.embedFont(StandardFonts.Helvetica);
      firstPage.drawRectangle({
        x: countyRect.x + 1,
        y: countyRect.y + 1,
        width: countyRect.width - 2,
        height: countyRect.height - 2,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
      firstPage.drawText(countyValue, {
        x: countyRect.x + 3,
        y: countyRect.y + (countyRect.height - 10) / 2,
        size: 10,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
    }

    const [copiedPage] = await outDoc.copyPages(tempDoc, [0]);
    outDoc.addPage(copiedPage);
  }

  return outDoc;
}

module.exports = { buildNjeisPdfForGroup };
