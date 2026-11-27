"""A curated ISO-4217 registry - the only currency list the Finance module knows.

Why a registry and not a table: ``GET /currencies`` must answer on a database with zero
rate rows, the rounding rules need *every* code that can appear in a ``currency`` column,
and the set of codes a personal ledger uses is small, stable and public. A row the user
can edit would let a typo change how money rounds.

The list is deliberately curated (~46 codes) rather than exhaustive (~180): it covers the
currencies ``docs/MYOS/PHASE3_FINANCE.md`` names plus the common trading partners of that
set. Anything outside it is a 422 ``validation_error`` from the service layer - the code
is never silently accepted, and never silently mapped to a nearby currency.

``minor_units`` is the ISO 4217 minor-unit exponent and it is the single number that
decides rounding: 2 for USD/INR/EUR…, 0 for JPY/KRW/VND/CLP/ISK. Codes with three minor
units (KWD, BHD, JOD, IQD, OMR, TND) are **excluded on purpose**: money columns are
``NUMERIC(14,2)``, so a 3-dp currency could be stored but never read back exactly.
Because of that exclusion ``decimal`` (the number of places the API writes) always
equals ``minor_units`` here; both are exposed so a client never has to infer one from
the other.

Rounding is ``ROUND_HALF_UP`` everywhere (PHASE3_FINANCE.md §2.1): bankers' rounding
would make ``0.005`` go down, which is not what a person checking a bill expects.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

#: every money column is ``NUMERIC(14,2)``, so 12 integer digits is the real ceiling
MAX_DIGITS = 14


@dataclass(frozen=True)
class Currency:
    code: str
    symbol: str
    name: str
    minor_units: int
    group: str

    @property
    def decimal(self) -> int:
        """Decimal places this currency is written with - see the module docstring."""
        return self.minor_units

    @property
    def quantum(self) -> Decimal:
        """The rounding step: ``0.01`` for a 2-minor-unit currency, ``1`` for a 0-unit one."""
        return Decimal(1).scaleb(-self.minor_units)

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "symbol": self.symbol,
            "name": self.name,
            "minor_units": self.minor_units,
            "decimal": self.decimal,
            "group": self.group,
        }


def _entry(code: str, symbol: str, name: str, group: str, minor_units: int = 2) -> Currency:
    return Currency(code=code, symbol=symbol, name=name, group=group, minor_units=minor_units)


#: registry order = display order: Americas, Europe, Middle East, Asia, Africa, Oceania
CURRENCIES: tuple[Currency, ...] = (
    # --- Americas
    _entry("USD", "$", "US Dollar", "Americas"),
    _entry("CAD", "C$", "Canadian Dollar", "Americas"),
    _entry("MXN", "MX$", "Mexican Peso", "Americas"),
    _entry("BRL", "R$", "Brazilian Real", "Americas"),
    _entry("ARS", "AR$", "Argentine Peso", "Americas"),
    _entry("CLP", "CLP$", "Chilean Peso", "Americas", 0),
    _entry("COP", "COL$", "Colombian Peso", "Americas"),
    _entry("PEN", "S/", "Peruvian Sol", "Americas"),
    # --- Europe
    _entry("EUR", "\u20ac", "Euro", "Europe"),
    _entry("GBP", "\u00a3", "Pound Sterling", "Europe"),
    _entry("CHF", "Fr", "Swiss Franc", "Europe"),
    _entry("SEK", "kr", "Swedish Krona", "Europe"),
    _entry("NOK", "kr", "Norwegian Krone", "Europe"),
    _entry("DKK", "kr", "Danish Krone", "Europe"),
    _entry("PLN", "z\u0142", "Polish Zloty", "Europe"),
    _entry("CZK", "K\u010d", "Czech Koruna", "Europe"),
    _entry("HUF", "Ft", "Hungarian Forint", "Europe"),
    _entry("RON", "lei", "Romanian Leu", "Europe"),
    _entry("ISK", "kr", "Icelandic Krona", "Europe", 0),
    _entry("RUB", "\u20bd", "Russian Ruble", "Europe"),
    _entry("UAH", "\u20b4", "Ukrainian Hryvnia", "Europe"),
    # --- Middle East
    _entry("AED", "AED", "UAE Dirham", "Middle East"),
    _entry("SAR", "SR", "Saudi Riyal", "Middle East"),
    _entry("QAR", "QR", "Qatari Riyal", "Middle East"),
    _entry("TRY", "\u20ba", "Turkish Lira", "Middle East"),
    _entry("EGP", "E\u00a3", "Egyptian Pound", "Middle East"),
    # --- Asia
    _entry("INR", "\u20b9", "Indian Rupee", "Asia"),
    _entry("PKR", "Rs", "Pakistani Rupee", "Asia"),
    _entry("BDT", "\u09f3", "Bangladeshi Taka", "Asia"),
    _entry("LKR", "Rs", "Sri Lankan Rupee", "Asia"),
    _entry("NPR", "Rs", "Nepalese Rupee", "Asia"),
    _entry("MYR", "RM", "Malaysian Ringgit", "Asia"),
    _entry("SGD", "S$", "Singapore Dollar", "Asia"),
    _entry("THB", "\u0e3f", "Thai Baht", "Asia"),
    _entry("IDR", "Rp", "Indonesian Rupiah", "Asia"),
    _entry("PHP", "\u20b1", "Philippine Peso", "Asia"),
    _entry("VND", "\u20ab", "Vietnamese Dong", "Asia", 0),
    _entry("KRW", "\u20a9", "South Korean Won", "Asia", 0),
    _entry("JPY", "\u00a5", "Japanese Yen", "Asia", 0),
    _entry("CNY", "\u00a5", "Chinese Yuan", "Asia"),
    # --- Africa
    _entry("ZAR", "R", "South African Rand", "Africa"),
    _entry("NGN", "\u20a6", "Nigerian Naira", "Africa"),
    _entry("KES", "KSh", "Kenyan Shilling", "Africa"),
    _entry("GHS", "GH\u20b5", "Ghanaian Cedi", "Africa"),
    # --- Oceania
    _entry("AUD", "A$", "Australian Dollar", "Oceania"),
    _entry("NZD", "NZ$", "New Zealand Dollar", "Oceania"),
)

BY_CODE: dict[str, Currency] = {currency.code: currency for currency in CURRENCIES}

#: the keys ``ENUMS["currency.code"]`` serves and the values the services accept
CODES: tuple[str, ...] = tuple(BY_CODE)


def is_valid(code: object) -> bool:
    """Is ``code`` a currency this install can store? Case is normalised by the caller."""
    return isinstance(code, str) and code in BY_CODE


def minor_units(code: str) -> int:
    """Decimal places of ``code``; unknown codes raise ``KeyError`` (services check first)."""
    return BY_CODE[code].minor_units


def normalise_as_of(value: dt.date | dt.datetime | None, today: dt.date) -> dt.date:
    """A rate/lookup date: ``None`` means *today*, a datetime is reduced to its date."""
    if value is None:
        return today
    if isinstance(value, dt.datetime):
        return value.date()
    return value


def quantize(amount: object, code: str) -> Decimal:
    """Round ``amount`` to ``code``'s minor units with ROUND_HALF_UP.

    Accepts ``Decimal``, ``int``, ``str`` or ``float`` - a float is routed through ``str``
    first, because ``Decimal(0.1)`` is ``0.1000000000000000055511151231257827`` and that
    noise would land in money. Nothing here *sums* floats: summation happens in Decimal
    and this function runs once, on the result (PHASE3_FINANCE.md §2.1).
    """
    if code not in BY_CODE:
        raise KeyError(f"unknown currency code: {code}")
    decimal = amount if isinstance(amount, Decimal) else Decimal(str(amount if amount is not None else 0))
    return decimal.quantize(BY_CODE[code].quantum, rounding=ROUND_HALF_UP)


def exponent(code: str) -> Decimal:
    """The quantum ``quantize`` uses for ``code`` (``0.01`` or ``1``)."""
    return BY_CODE[code].quantum


def as_float(amount: Decimal | None) -> float | None:
    """Money at the JSON boundary: already quantised server-side, so a float is a display
    number and never an operand (PHASE3_FINANCE.md §2.2)."""
    return None if amount is None else float(amount)
