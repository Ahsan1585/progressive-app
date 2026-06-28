const puppeteer = require('puppeteer');

const generateInvoicePDF = async (invoiceData) => {
  // Helper function to render a checked or unchecked box
  const renderCheck = (serviceType) => {
    // Assuming invoiceData.serviceTypes is an array or object of selected services
    const isSelected = invoiceData.serviceTypes.includes(serviceType);
    return isSelected ? '☑' : '☐';
  };

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body class="bg-white text-black font-sans text-[13px] p-8 max-w-4xl mx-auto leading-relaxed">
      
      <h1 class="text-center font-bold text-base underline mb-8">BILLING INVOICE PROGRESSIVE STEPS</h1>

      <div class="space-y-3 mb-8 w-3/4">
        <div class="flex"><span class="font-bold w-40">Company Name:</span> <span class="border-b border-black flex-1 px-2">${invoiceData.companyName || 'Progressive Steps'}</span></div>
        <div class="flex"><span class="font-bold w-40">Therapists Name:</span> <span class="border-b border-black flex-1 px-2">${invoiceData.therapistName}</span></div>
        <div class="flex"><span class="font-bold w-40">Address:</span> <span class="border-b border-black flex-1 px-2">${invoiceData.address || ''}</span></div>
        <div class="flex"><span class="font-bold w-40">Phone:</span> <span class="border-b border-black flex-1 px-2">${invoiceData.phone || ''}</span></div>
        <div class="flex"><span class="font-bold w-40">EIN/SSN #</span> <span class="border-b border-black flex-1 px-2">${invoiceData.einSsn || ''}</span></div>
      </div>

      <div class="flex gap-4 font-bold mb-6 items-center">
        <span>${renderCheck('DI')} DI</span>
        <span>${renderCheck('CDA')} CDA</span>
        <span>${renderCheck('OT')} OT</span>
        <span>${renderCheck('PT')} PT</span>
        <span>${renderCheck('ST')} ST</span>
        <span>${renderCheck('SW')} SW</span>
        <span>${renderCheck('IT')} IT</span>
      </div>

      <table class="w-full border-collapse border-2 border-black mb-8 text-center text-xs">
        <thead class="font-bold">
          <tr>
             <th class="border border-black p-2 w-16">Child ID#</th>
             <th class="border border-black p-2 w-24">County</th>
             <th class="border border-black p-2">Child's Name</th>
             <th class="border border-black p-2 w-20">Service<br>Date</th>
             <th class="border border-black p-2 w-20">Services<br>(hours)</th>
             <th class="border border-black p-2 w-20">Rate of<br>Pay</th>
             <th class="border border-black p-2 w-24">Notes in EIMS<br>(Y/N)</th>
          </tr>
        </thead>
        <tbody>
           ${invoiceData.lineItems.map(item => `
             <tr class="h-8">
               <td class="border border-black p-1">${item.child_id || ''}</td>
               <td class="border border-black p-1">${item.county || ''}</td>
               <td class="border border-black p-1 text-left px-2">${item.child_name || ''}</td>
               <td class="border border-black p-1">${(([y,m,d]) => `${parseInt(m)}/${parseInt(d)}/${y}`)((item.service_date||'').split('-'))}</td>
               <td class="border border-black p-1">${item.hours || ''}</td>
               <td class="border border-black p-1">$${item.rate_of_pay.toFixed(2)}</td>
               <td class="border border-black p-1">${item.notes_in_eims ? 'Y' : 'N'}</td>
             </tr>
           `).join('')}
           
           </tbody>
      </table>

      <div class="border-2 border-black p-4 text-[11px] font-bold mb-16">
         <h2 class="text-center mb-3 text-sm">CLAIMANT'S CERTIFICATION AND DECLARATION</h2>
         <p class="mb-3">I do solemnly declare and certify that all hours specified above have been previously approved by the IF-SP and are hereby in compliance with the contractual Agreement between Progressive Steps and the New Jersey Department of Health and Senior Services.</p>
         <p>Furthermore, I fully Accept and Acknowledge that any hours which may exceed the time allotted by said contractual agreement may not be presented for payment at the discretion of Progressive Steps.</p>
      </div>

      <div class="flex justify-between items-end font-bold px-4">
        <div class="w-1/2">
           <div class="border-b border-black mb-1 h-12 flex items-end">
              </div>
           <div>Therapist Signature</div>
        </div>
        <div class="w-1/3">
           <div class="border-b border-black mb-1 h-12 flex items-end pb-1 px-2">
              ${new Date().toLocaleDateString()}
           </div>
           <div>Date:</div>
        </div>
      </div>
    </body>
    </html>
  `;

  // Launch Puppeteer to generate the PDF
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  // Load the HTML into the page
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  
  // Generate the PDF buffer
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
  });

  await browser.close();
  
  return pdfBuffer;
};

module.exports = { generateInvoicePDF };