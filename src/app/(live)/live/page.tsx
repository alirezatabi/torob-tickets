import { redirect } from "next/navigation";

/** The retired demo-provider dashboard is replaced by truthful crawler status. */
export default function LivePage(): never {
  redirect("/crawl");
}
