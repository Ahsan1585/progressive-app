const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { getDisciplineCode } = require('./disciplineCodes');
const { formatTime12h } = require('./formatting');

// Helper function to convert Image
const fetchImageBuffer = async (imageSource) => {
  try {
    if (imageSource.startsWith('data:image')) {
      const base64Data = imageSource.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    } else if (imageSource.startsWith('http')) {
      const response = await fetch(imageSource);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    return null;
  } catch (error) {
    console.error("Error fetching signature image:", error);
    return null;
  }
};

// Helper to format "2026-06-22" into "06/22/26" so it fits the small boxes
const formatShortDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const year = String(d.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
};

const generateNjeisPDF = async (practitioner, child, encounters, targetMonthYear, companyName = '') => {
  const templatePath = path.join(__dirname, '../../templates/NJEIS-020.pdf');
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const page = pdfDoc.getPages()[0]; 

  const fillField = (fieldName, text) => {
    try {
      if (!text) return;
      const field = form.getTextField(fieldName);
      field.setFontSize(10); 
      field.setText(String(text));
    } catch (error) {
      console.warn(`Warning: Could not find or fill text field '${fieldName}'`);
    }
  };

  const drawSignatureInField = async (fieldName, imageSource) => {
    try {
      if (!imageSource) return false;
      
      const field = form.getTextField(fieldName);
      const widgets = field.acroField.getWidgets();
      if (!widgets || widgets.length === 0) return false;
      
      const rect = widgets[0].getRectangle();
      const imgBuffer = await fetchImageBuffer(imageSource);
      if (!imgBuffer) return false;

      let embeddedImage;
      // 🌟 USE .startsWith() INSTEAD OF .includes() TO PREVENT CRASHES
      if (imageSource.startsWith('data:image/jpeg') || imageSource.startsWith('data:image/jpg')) {
        embeddedImage = await pdfDoc.embedJpg(imgBuffer);
      } else {
        embeddedImage = await pdfDoc.embedPng(imgBuffer);
      }

      // 🌟 DYNAMIC SIZING: Adjust size based on WHICH signature it is
      let sigWidth, sigHeight, yOffset;

      if (fieldName.includes('ParentCaregiver')) {
        // Table Rows: Smaller height to ensure a gap between rows
        sigWidth = 55;
        sigHeight = 18; 
        yOffset = rect.y + 2; // Anchors exactly to the bottom line of the row
      } else {
        // Practitioner Signature: Can be much larger
        sigWidth = 80;
        sigHeight = 35;
        yOffset = rect.y - 5; // Pulls it slightly down to anchor on the signature line
      }
      
      // 🌟 1. Scale the image initially to get perfect, un-stretched proportions
      const baseDims = embeddedImage.scaleToFit(rect.width, rect.height);

      // 🌟 2. Set up variables for final placement
      let finalX = rect.x;
      let finalYPosition = rect.y;
      let finalWidth = baseDims.width;
      let finalHeight = baseDims.height;

      // 🌟 3. Apply targeted tweaks to the Practitioner Signature
      if (fieldName.includes('Practitioner')) {
        // ⬆️ POSITION: Changed from -15 to -3 to bring it back up to the line
        finalYPosition = rect.y - 3;

        // 🔎 SIZE: Multiply the width and height to make it larger! (1.5 = 50% bigger)
        // If it is still too small, change 1.5 to 1.8 or 2.0
        finalWidth = baseDims.width * 1.5;
        finalHeight = baseDims.height * 1.5;
      } else {
        // Parent signature source images are mostly blank canvas around a small
        // stroke, so a tight fit-to-box scale still reads as tiny — enlarge
        // beyond that too, re-centered on the same cell so it grows evenly
        // instead of drifting from the bottom-left anchor.
        const enlarged = 1.5;
        finalWidth = baseDims.width * enlarged;
        finalHeight = baseDims.height * enlarged;
        finalX = rect.x + (rect.width - finalWidth) / 2;
        finalYPosition = rect.y + 2 + (baseDims.height - finalHeight) / 2;
      }

      // 🌟 4. Draw the perfectly proportioned, resized image in its final position
      page.drawImage(embeddedImage, {
        x: finalX,
        y: finalYPosition,
        width: finalWidth,
        height: finalHeight,
      });

      field.setText('');
      return true;
    } catch (error) {
      console.error(`Failed to draw signature for field ${fieldName}:`, error);
      return false;
    }
  };

  // --- HEADER INFO ---
  fillField('Service Provider Agency Name', companyName);
  fillField('Practitioner First Name', practitioner.first_name);
  fillField('Practitioner Last Name', practitioner.last_name);
  
  // 🌟 FIXED: Dynamic Position Title 🌟
  fillField('DisciplinePosition Title', getDisciplineCode(practitioner.position_title) || 'Practitioner');
  
  fillField('Childs First Name', child.first_name);
  fillField('Childs Last Name', child.last_name);
  fillField('MI', child.middle_name ? child.middle_name.charAt(0) : '');
  fillField('DOB', formatShortDate(child.dob));
  fillField('County', child.county || 'N/A');
  fillField('Child ID', child.child_id || 'N/A');
  
  fillField('MonthYear', targetMonthYear);

  // --- THE ENCOUNTER TABLE ---
  const maxRows = Math.min(encounters.length, 10);
  for (let index = 0; index < maxRows; index++) {
    const encounter = encounters[index];
    const rowNum = index + 1; 
    
    // Format the encounter date
    const formattedDate = formatShortDate(encounter.date || encounter.service_date);
    
    fillField(`Service date${rowNum}`, formattedDate);
    
    // 🌟 FIXED: Dynamic Status, Type, and Location (Removed Hardcoding) 🌟
    fillField(`Service StatusRow${rowNum}`, encounter.status || '1');
    fillField(`Service TypeRow${rowNum}`, encounter.type || 'DI');
    fillField(`Service LocationRow${rowNum}`, encounter.location || '1');
    
    fillField(`Start TimeRow${rowNum}`, formatTime12h(encounter.start_time));
    fillField(`End TimeRow${rowNum}`, formatTime12h(encounter.end_time));
    
    const hours = encounter.total_time ? (encounter.total_time / 60).toFixed(2) : encounter.hours;
    fillField(`Total TimeRow${rowNum}`, `${hours} hrs`);
    
    const parentSigField = `ParentCaregiver Signature Verifying Services ReceivedRow${rowNum}`;
    const hasImage = await drawSignatureInField(parentSigField, encounter.parent_signature);
    
    if (!hasImage) {
      fillField(parentSigField, 'Signed electronically on file');
    }
  }

  // --- BOTTOM SIGNATURE ---
  const pracSigImage = encounters[0]?.practitioner_signature;
  const hasPracImage = await drawSignatureInField('Practitioner Signature', pracSigImage);

  if (!hasPracImage) {
    fillField('Practitioner Signature', `${practitioner.first_name} ${practitioner.last_name}`);
  }

  // The date next to the practitioner's signature is the date of the most
  // recent session actually listed in the encounter table above (rows 1
  // through maxRows) — not today's date, which is just whenever this PDF
  // happened to be generated/regenerated and has no bearing on when the
  // certified services took place.
  const encountersOnForm = encounters.slice(0, maxRows);
  const sessionDates = encountersOnForm
    .map((e) => e.date || e.service_date)
    .filter(Boolean)
    .map((raw) => ({ raw, time: new Date(raw).getTime() }))
    .filter((d) => !isNaN(d.time));
  const lastSessionDate = sessionDates.length > 0
    ? sessionDates.reduce((latest, d) => (d.time > latest.time ? d : latest)).raw
    : null;

  fillField('Date', formatShortDate(lastSessionDate || new Date().toISOString()));

  form.flatten();
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};

module.exports = { generateNjeisPDF };