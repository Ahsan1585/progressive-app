const { z } = require('zod');

// Before field-level encryption, Postgres's `date` column type normalized
// whatever date string arrived (ISO, "01/15/2023", a timestamp) into a
// plain YYYY-MM-DD on write. Now that dob is encrypted as a `text` column,
// nothing does that normalization for us — the raw string is encrypted
// verbatim. Several consumers assume YYYY-MM-DD after decrypting (the
// consent DOB check's dobToIso, EIMS's strict string equality,
// njeisFormFiller's split('-')), so this schema is the one place left to
// enforce that shape before the value is ever encrypted.
const dobSchema = z.string().refine((val) => /^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val)), {
  message: "dob must be in YYYY-MM-DD format",
});

const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional(),
  dob: dobSchema,
  county: z.string().min(1),
  childId: z.string().regex(/^\d{9}$/, "Child ID must be exactly 9 digits"),
  parentName: z.string().optional(),
  parentEmail: z.string().email().optional().or(z.literal(""))
});

module.exports = { patientSchema, dobSchema };