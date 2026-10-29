import "server-only";
import { z } from "zod";

/** Ids come from URLs and forms: anything that is not a UUID is simply "not found", never a database error. */
export const isUuid = (id: string) => z.uuid().safeParse(id).success;
