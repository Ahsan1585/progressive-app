const { z } = require('zod');

const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional(),
  dob: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Invalid Date" }),
  county: z.string().min(1),
  childId: z.string().min(1)
});

module.exports = { patientSchema };