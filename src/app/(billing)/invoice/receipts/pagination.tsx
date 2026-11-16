import Link from "next/link";

export function Pagination({
  page,
  hasNext,
  href,
}: {
  page: number;
  hasNext: boolean;
  href: (page: number) => string;
}) {
  if (page === 1 && !hasNext) return null;

  return (
    <nav className="billing-toolbar" aria-label="Pagination">
      {page > 1 && (
        <Link className="billing-button" href={href(page - 1)}>
          Previous
        </Link>
      )}
      <span>Page {page}</span>
      {hasNext && (
        <Link className="billing-button" href={href(page + 1)}>
          Next
        </Link>
      )}
    </nav>
  );
}
