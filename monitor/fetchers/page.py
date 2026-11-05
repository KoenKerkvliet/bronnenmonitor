"""Gewone webpagina's zonder feed. Wordt gebouwd in fase 2."""
from . import Item


def fetch(source: dict) -> list[Item]:
    raise NotImplementedError("Brontype 'page' komt in fase 2.")
