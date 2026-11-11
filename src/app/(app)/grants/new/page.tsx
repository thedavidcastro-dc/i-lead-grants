import { requireAdmin } from "@/lib/auth";
import { listFunders, db } from "@/lib/grants/data";
import { GrantForm } from "@/components/grant-form";
import { PageHeader, Flash, Card, Crumbs } from "@/components/ui";

export default async function NewGrantPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;
  const [funders, g] = await Promise.all([listFunders(), db()]);
  const { data: classes } = await g.from("qbo_classes").select("id, name").eq("active", true).order("name");
  return (
    <div className="space-y-6 max-w-4xl">
      <Crumbs items={[{ href: "/grants", label: "Grants" }, { label: "New grant" }]} />
      <PageHeader eyebrow="Grants" title="New grant" sub="Enter what you know; the budget extraction fills in amounts, dates and reporting from the documents later." />
      <Flash error={error} />
      <Card><GrantForm funders={funders} classes={classes ?? []} /></Card>
    </div>
  );
}
