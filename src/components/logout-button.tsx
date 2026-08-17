"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { logout } from "@/app/login/actions";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => void logout())}
    >
      {pending ? "Saliendo…" : "Salir"}
    </Button>
  );
}
