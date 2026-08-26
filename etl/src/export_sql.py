"""Generate SQL for manual import when service_role key is unavailable."""

from __future__ import annotations

from .parse_bulletin import ParsedBulletin, slugify_company


def export_bulletin_sql(parsed: ParsedBulletin) -> str:
    lines = [
        "-- GasTa ETL SQL export — run in Supabase Dashboard → SQL Editor",
        f"-- Region: {parsed.region_code} | Week: {parsed.week_label}",
        "",
        "insert into public.oil_companies (name, slug)",
        "values",
    ]

    companies = sorted({p.company for p in parsed.prices})
    company_values = ",\n".join(
        f"  ('{c.replace(chr(39), chr(39)+chr(39))}', '{slugify_company(c)}')" for c in companies
    )
    lines.append(company_values)
    lines.append("on conflict (slug) do nothing;")
    lines.append("")

    notes = f"ETL import — {parsed.week_label}".replace("'", "''")
    source = parsed.source_path.replace("'", "''")
    lines.extend(
        [
            "insert into public.fuel_price_bulletins (bulletin_date, source_pdf_url, notes)",
            f"values ('{parsed.bulletin_date.isoformat()}', '{source}', '{notes}')",
            "on conflict (bulletin_date) do update set",
            "  source_pdf_url = excluded.source_pdf_url,",
            "  notes = excluded.notes;",
            "",
        ]
    )

    for price in parsed.prices:
        slug = slugify_company(price.company)
        lines.append(
            "insert into public.fuel_prices "
            "(bulletin_id, region_id, oil_company_id, fuel_type_id, price_per_liter)"
        )
        lines.append("select b.id, r.id, c.id, ft.id, "
                     f"{price.price_per_liter:.2f}")
        lines.append("from public.fuel_price_bulletins b")
        lines.append("join public.regions r on r.code = "
                     f"'{parsed.region_code}'")
        lines.append("join public.oil_companies c on c.slug = "
                     f"'{slug}'")
        lines.append("join public.fuel_types ft on ft.code = "
                     f"'{price.fuel_type_code}'")
        lines.append(f"where b.bulletin_date = '{parsed.bulletin_date.isoformat()}'")
        lines.append(
            "on conflict (bulletin_id, region_id, oil_company_id, fuel_type_id) "
            "do update set price_per_liter = excluded.price_per_liter;"
        )
        lines.append("")

    return "\n".join(lines)
