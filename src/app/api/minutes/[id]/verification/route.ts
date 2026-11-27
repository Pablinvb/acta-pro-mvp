import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { toErrorResponse } from "@/lib/api/http";
import { issueCode } from "@/lib/signing-code";

export async function POST(_request: Request, context: {params: Promise<{id:string}>}) {
  try {
    const {id}=await context.params;
    await issueCode(await requireApiSession(),id);
    return NextResponse.json({sent:true});
  } catch (error) { return toErrorResponse(error); }
}
