const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

async function listFields() {
  // Load your blank template
  const pdfBytes = fs.readFileSync('./templates/NJEIS-020.pdf');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  
  // Get all fields and print their hidden names
  const fields = form.getFields();
  console.log("--- HERE ARE THE FIELD NAMES IN YOUR PDF ---");
  fields.forEach(field => {
    console.log(`Name: "${field.getName()}" | Type: ${field.constructor.name}`);
  });
}

listFields();