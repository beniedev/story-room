#!/usr/bin/env python3
"""Convert one Story Native JSON export into a new Obsidian vault directory."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any


INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def safe_name(value: str, fallback: str) -> str:
    cleaned = INVALID_FILENAME.sub("-", value).strip().rstrip(". ")
    if not cleaned or cleaned.upper() in RESERVED_NAMES:
        cleaned = fallback
    return cleaned[:100]


def require_book(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Story Native export must be a JSON object.")
    for key in ("id", "title", "characters", "worldRules", "canonFacts", "summaries", "chapters"):
        if key not in value:
            raise ValueError(f"Story Native export is missing {key!r}.")
    if not isinstance(value["id"], str) or not isinstance(value["title"], str):
        raise ValueError("Book id and title must be strings.")
    for key in ("characters", "worldRules", "canonFacts", "summaries", "chapters"):
        if not isinstance(value[key], list):
            raise ValueError(f"Story Native field {key!r} must be a list.")
    return value


def yaml_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def frontmatter(kind: str, item_id: str, **properties: Any) -> str:
    rows = ["---", f"story-native-type: {yaml_value(kind)}", f"story-native-id: {yaml_value(item_id)}"]
    for key, value in properties.items():
        rows.append(f"story-native-{key.replace('_', '-')}: {yaml_value(value)}")
    rows.extend(["---", ""])
    return "\n".join(rows)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def source_document(kind: str, item: dict[str, Any], order: int, body: str | None = None) -> str:
    loaded = item.get("loadedSectionIds", "all")
    return frontmatter(
        kind,
        str(item.get("id", "")),
        order=order,
        include_in_prompt=bool(item.get("includeInPrompt", False)),
        loaded_sections=loaded,
    ) + (body if body is not None else str(item.get("content", "")))


def wikilink(path: Path, label: str) -> str:
    return f"[[{path.as_posix()}|{label}]]"


def convert(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Input JSON does not exist: {source}")
    if destination.exists() and any(destination.iterdir()):
        raise FileExistsError(f"Output directory is not empty: {destination}")

    book = require_book(json.loads(source.read_text(encoding="utf-8-sig")))
    destination.mkdir(parents=True, exist_ok=True)

    backup = destination / ".story-native" / "book.json"
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, backup)

    write_text(destination / "AGENTS.md", """# Story Native vault rules

- This vault contains one isolated Book. Never mix its characters, settings, or manuscript with another Book.
- The author decides plot and canon. Do not silently rewrite or delete source material.
- Preserve every `story-native-id`; filenames and titles may change, IDs must not.
- Manuscript files remain continuous prose. Do not turn them into chat bubbles or message timelines.
- Preview changes before a bulk rename, move, merge, or deletion.
""")

    book_id = str(book["id"])
    write_text(destination / "Book.md", frontmatter("book", book_id, updated_at=book.get("updatedAt", "")) + f"# {book['title']}\n")
    write_text(destination / "Guides" / "Writing-Style.md", frontmatter("writing-style", f"{book_id}:writing-style") + str(book.get("writingBrief", "")))
    write_text(destination / "Guides" / "Plot-Outline.md", frontmatter("plot-outline", f"{book_id}:plot-outline") + str(book.get("plotOutline", "")))

    index_lines = [f"# {book['title']}", "", "## 全局指引", "", "- [[Guides/Writing-Style|写作风格指导]]", "- [[Guides/Plot-Outline|剧情大纲]]"]

    groups = (
        ("characters", "Characters", "角色卡", "character"),
        ("worldRules", "World", "世界观设定", "world"),
        ("canonFacts", "Canon", "Canon", "canon"),
        ("summaries", "State/Summaries", "剧情摘要", "summary"),
    )
    for field, folder, heading, kind in groups:
        items = book.get(field, [])
        if not items:
            continue
        index_lines.extend(["", f"## {heading}", ""])
        for order, raw in enumerate(items, 1):
            if not isinstance(raw, dict):
                continue
            title = str(raw.get("name") or raw.get("title") or f"{heading}-{order}")
            filename = f"{order:02d}-{safe_name(title, f'{kind}-{order}')}.md"
            relative = Path(folder) / filename
            if kind == "character":
                body = f"# {title}\n\n## 角色要点\n\n{raw.get('role', '')}\n\n## 角色设定\n\n{raw.get('content', '')}"
            else:
                body = f"# {title}\n\n{raw.get('content', '')}"
            write_text(destination / relative, source_document(kind, raw, order, body))
            index_lines.append(f"- {wikilink(relative.with_suffix(''), title)}")

    index_lines.extend(["", "## 目录", ""])
    for chapter_order, raw_chapter in enumerate(book["chapters"], 1):
        if not isinstance(raw_chapter, dict):
            continue
        chapter_title = str(raw_chapter.get("title") or f"第 {chapter_order} 章")
        chapter_folder = Path("Chapters") / f"{chapter_order:02d}-{safe_name(chapter_title, f'chapter-{chapter_order}')}"
        index_lines.append(f"- **{chapter_order}. {chapter_title}**")
        sections = raw_chapter.get("sections", [])
        if not isinstance(sections, list):
            continue
        for section_order, raw_section in enumerate(sections, 1):
            if not isinstance(raw_section, dict):
                continue
            section_id = str(raw_section.get("id", f"section-{chapter_order}-{section_order}"))
            section_title = str(raw_section.get("title") or f"第 {section_order} 节")
            relative = chapter_folder / f"{section_order:02d}-{safe_name(section_title, f'section-{section_order}')}.md"
            document = frontmatter(
                "section",
                section_id,
                chapter_id=str(raw_chapter.get("id", "")),
                chapter_order=chapter_order,
                section_order=section_order,
                note=raw_section.get("note", ""),
            ) + f"# {section_title}\n\n{raw_section.get('content', '')}"
            write_text(destination / relative, document)
            index_lines.append(f"  - {wikilink(relative.with_suffix(''), f'{chapter_order}.{section_order} {section_title}')}")

    write_text(destination / "Index.md", "\n".join(index_lines))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_vault", type=Path)
    args = parser.parse_args()
    convert(args.input_json.resolve(), args.output_vault.resolve())


if __name__ == "__main__":
    main()
