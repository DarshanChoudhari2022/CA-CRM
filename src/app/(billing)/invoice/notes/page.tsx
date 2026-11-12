import { BillingDocumentsPage, type BillingSearch } from "@/modules/billing/documents-page";

export default function Page({ searchParams }: { searchParams: BillingSearch }) {
  return <BillingDocumentsPage section="notes" searchParams={searchParams} />;
}
