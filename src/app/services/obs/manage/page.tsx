import { ManagementPageForService, type ManagementSearch } from "@/app/services/_components/management-page";
export default function Page({ searchParams }: { searchParams: ManagementSearch }) { return <ManagementPageForService service="obs" searchParams={searchParams} />; }
