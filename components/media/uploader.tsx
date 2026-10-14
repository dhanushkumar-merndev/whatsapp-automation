"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/browser";
import { createUploadAction, finalizeUploadAction } from "@/app/(dashboard)/media/actions";

export function MediaUploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(file.name);
    try {
      const start = await createUploadAction({ name: file.name, mimeType: file.type, size: file.size });
      if (!start.ok) throw new Error(start.error);
      const { assetId, path, token } = start.data!;
      const { error } = await createClient().storage.from("media").uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      const done = await finalizeUploadAction({ assetId });
      if (!done.ok) throw new Error(done.error);
      toast.success(`${file.name} uploaded`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,video/mp4,video/3gpp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <Button onClick={() => input.current?.click()} disabled={Boolean(busy)}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {busy ? `Uploading ${busy.slice(0, 24)}…` : "Upload file"}
      </Button>
    </>
  );
}
