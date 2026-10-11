import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import Input, { Textarea } from "../ui/Input.jsx";

// Field limits mirror the server validation in server/routes/bots.js, so the
// user gets immediate feedback instead of a 400.
const LIMITS = { name: 50, job: 100, instructions: 4000 };

export default function TeammateForm({ open, teammate, onClose, onSubmit }) {
  const isEdit = Boolean(teammate);

  const [form, setForm] = useState({ name: "", job: "", instructions: "" });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form whenever the dialog opens for a different teammate.
  useEffect(() => {
    if (!open) return;
    setForm({
      name: teammate?.name ?? "",
      job: teammate?.job ?? "",
      instructions: teammate?.instructions ?? "",
    });
    setError(null);
    setSubmitting(false);
  }, [open, teammate]);

  function update(field) {
    return (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  }

  const invalid =
    form.name.trim().length === 0 ||
    form.name.trim().length > LIMITS.name ||
    form.job.trim().length === 0 ||
    form.job.trim().length > LIMITS.job ||
    form.instructions.length > LIMITS.instructions;

  async function submit(event) {
    event.preventDefault();
    if (invalid) return;

    setSubmitting(true);
    setError(null);

    try {
      // The API derives the avatar seed server-side; it is never sent from here.
      await onSubmit({
        name: form.name.trim(),
        job: form.job.trim(),
        instructions: form.instructions.trim(),
      });
      onClose?.();
    } catch (submitError) {
      setError(submitError?.message || "Could not save the teammate.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? `Edit ${teammate?.name ?? "teammate"}` : "New AI teammate"}
      description={
        isEdit
          ? "Update the job description and instructions used to prompt this teammate."
          : "Give the teammate a job and, optionally, detailed instructions."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="teammate-form" loading={submitting} disabled={invalid}>
            {isEdit ? "Save changes" : "Create teammate"}
          </Button>
        </>
      }
    >
      <form id="teammate-form" onSubmit={submit} className="space-y-4">
        <Input
          label="Name"
          name="name"
          required
          maxLength={LIMITS.name}
          value={form.name}
          onChange={update("name")}
          placeholder="Research Analyst"
          hint={`Up to ${LIMITS.name} characters.`}
        />

        <Input
          label="Job"
          name="job"
          required
          maxLength={LIMITS.job}
          value={form.job}
          onChange={update("job")}
          placeholder="Find and summarise sources on a topic"
          hint={`Up to ${LIMITS.job} characters. Becomes the teammate's core prompt.`}
        />

        <Textarea
          label="Instructions"
          name="instructions"
          rows={6}
          maxLength={LIMITS.instructions}
          value={form.instructions}
          onChange={update("instructions")}
          placeholder="Optional. Tone, constraints, tools to prefer, output format…"
          hint={`Optional, up to ${LIMITS.instructions} characters.`}
        />

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
