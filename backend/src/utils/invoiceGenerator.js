const puppeteer = require('puppeteer');

const generateInvoicePDF = async (practitioner, encounters) => {
  // 1. Map through the actual database encounters to generate the HTML table rows
  const tableRows = encounters.map(enc => {
    return `
      <tr>
        <td>${enc.child_id}</td>
        <td>${enc.county}</td>
        <td>${enc.child_name}</td>
        <td>${enc.date}</td>
        <td>${enc.total_hours}</td>
        <td>${enc.rate_of_pay}</td>
        <td>Y</td>
      </tr>
    `;
  }).join('');

  // 2. Build the full HTML document dynamically
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <style>
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 40px; color: black; }
          .title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 14px; margin-bottom: 30px; }
          .info-row { display: flex; align-items: flex-end; margin-bottom: 15px; font-weight: bold; }
          .info-label { width: 130px; }
          .info-line { flex-grow: 1; border-bottom: 1px solid black; height: 18px; font-weight: normal; padding-left: 5px; }
          .therapy-types { text-align: center; font-weight: bold; margin: 20px 0; word-spacing: 5px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          th, td { border: 1px solid black; padding: 8px; text-align: center; }
          th { font-weight: bold; font-size: 11px; background-color: #f9f9f9; }
          .child-name-col { width: 30%; }
          .declaration-box { border: 2px solid black; padding: 15px; margin-top: 20px; page-break-inside: avoid; }
          .declaration-title { text-align: center; font-weight: bold; margin-bottom: 10px; }
          .declaration-text { font-size: 11px; line-height: 1.4; margin-bottom: 30px; text-align: justify; }
          .signature-row { display: flex; justify-content: space-between; font-weight: bold; }
      </style>
  </head>
  <body>
      <div class="title">BILLING INVOICE PROGRESSIVE STEPS</div>

      <div class="info-row">
          <div class="info-label">Company Name:</div>
          <div class="info-line">Progressive Steps</div>
      </div>
      <div class="info-row">
          <div class="info-label">Therapists Name:</div>
          <div class="info-line">${practitioner.first_name} ${practitioner.last_name}</div>
      </div>
      
      <div class="info-row">
          <div class="info-label">Address:</div>
          <div class="info-line">${practitioner.address || ''}</div>
      </div>
      <div class="info-row">
          <div class="info-label">Phone:</div>
          <div class="info-line">${practitioner.phone_number || ''}</div>
      </div>
      <div class="info-row">
          <div class="info-label">EIN/SSN #:</div>
          <div class="info-line">${practitioner.ssn || ''}</div>
      </div>

      <div class="therapy-types">
          DI___ CDA___ OT___ PT___ ST___ SW___ IT___
      </div>

      <table>
          <thead>
              <tr>
                  <th>Child ID#</th>
                  <th>County</th>
                  <th class="child-name-col">Child's Name</th>
                  <th>Service<br>Date</th>
                  <th>Services<br>(hours)</th>
                  <th>Rate<br>of<br>Pay</th>
                  <th>Notes<br>in EIMS<br>(Y/N)</th>
              </tr>
          </thead>
          <tbody>
              ${tableRows}
          </tbody>
      </table>

      <div class="declaration-box">
          <div class="declaration-title">CLAIMANT'S CERTIFICATION AND DECLARATION</div>
          <div class="declaration-text">
              I do solemnly declare and certify that all hours specified above have been previously approved by the IF-SP and are hereby in compliance with the contractual Agreement between Progressive Steps and the New Jersey Department of Health and Senior Services.<br><br>
              Furthermore, I fully Accept and Acknowledge that any hours which may exceed the time allotted by said contractual agreement may not be presented for payment at the discretion of Progressive Steps.
          </div>
          <div class="signature-row">
              <div>Therapist Signature: _______________________</div>
              <div>Date: _______________</div>
          </div>
      </div>
  </body>
  </html>
  `;

  // 3. Launch Puppeteer
  // Tell Puppeteer to use PUPPETEER_EXECUTABLE_PATH if it exists in .env
  const browser = await puppeteer.launch({
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Load the HTML content
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  // Generate the PDF buffer
  const pdfBuffer = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
  });

  await browser.close();

  return pdfBuffer;
};

module.exports = { generateInvoicePDF };