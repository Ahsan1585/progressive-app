import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import api from "../api/axiosInstance";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const formSchema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  middleName: z.string().optional(),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  dob: z.string().min(1, "Date of Birth is required"),
  county: z.string().min(2, "County is required"),
  childId: z.string().regex(/^\d{9}$/, "Child ID must be exactly 9 digits"),
});

export function AddPatientModal({
  onPatientAdded,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  onPatientAdded: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { firstName: "", middleName: "", lastName: "", dob: "", county: "", childId: "" },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      await api.post("/api/patients/register", values);
      onPatientAdded();
      form.reset();
      setOpen(false);
    } catch (error) {
      console.error("Submission failed:", error);
      alert("Failed to register patient. Check console for details.");
    }
  };

  const handleCancel = () => {
    form.reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button variant="default">+ Add New Patient</Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="sm:max-w-[425px]"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Register Patient</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="firstName" render={({ field }) => (
              <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="middleName" render={({ field }) => (
              <FormItem>
                <FormLabel>Middle Name <span className="text-slate-400 font-normal text-xs">(optional)</span></FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="lastName" render={({ field }) => (
              <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="dob" render={({ field }) => (
              <FormItem><FormLabel>Date of Birth</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="county" render={({ field }) => (
              <FormItem><FormLabel>County</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="childId" render={({ field }) => (
              <FormItem>
                <FormLabel>Child ID</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    inputMode="numeric"
                    maxLength={9}
                    onChange={(e) => field.onChange(e.target.value.replace(/\D/g, '').slice(0, 9))}
                  />
                </FormControl>
                <p className="text-xs text-slate-400">Please enter the 9 digit child id provided.</p>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleCancel}>Cancel</Button>
              <Button type="submit">Register Patient</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
