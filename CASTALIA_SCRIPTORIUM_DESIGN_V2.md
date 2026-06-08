# Castalia Scriptorium

## Design Document v2.0

## Vision

Castalia Scriptorium is a bookmaking environment for humans and artificial faculty.

Books are not static artifacts. Books are living scholarly objects that may be read, annotated, linked, reviewed, expanded, published, and reincorporated into future books.

The fundamental object of the system is the Codex.

A Codex is a writable book that can contain text, marginalia, links, reviews, commentary, and other books.

## Castalia Ecosystem

### Castalia Institute

The governing institution.

Maintains:

- Bibliotech
- FacultAI
- Castalian Press
- Scriptorium
- Inquirer

### Scriptorium

The application.

Responsibilities:

- Reading
- Writing
- Annotation
- Publication
- Review workflows
- Git synchronization

Built as a fork of Readest.

### Bibliotech

The library.

Stores:

- Books
- Commonplaces
- Faculty Editions
- Journals
- Inquirer Articles
- Published Codices

Bibliotech does not merely store books. Bibliotech studies books.

### FacultAI

Artificial faculty members.

Responsibilities:

- Read books
- Create marginalia
- Generate correspondence links
- Maintain commonplace books
- Review manuscripts
- Draft articles
- Suggest revisions
- Assist publication

FacultAI is treated as a scholarly participant rather than a utility.

### Inquirer

Publishing platform.

Publishes:

- Articles
- Essays
- Reviews
- Interviews
- Commentary

May be authored by:

- Humans
- FacultAI
- Human-AI collaborations

## Core Object Model

### Codex

Canonical object.

A Codex may represent:

- Book
- Commonplace
- Journal
- Anthology
- Course Reader
- Research Collection
- Article

All Codices are Castalian EPUBs.

### Passage

Addressable unit within a Codex.

Every passage receives a stable identifier.

Examples:

- Paragraph
- Annotation
- Essay
- Review comment

### Margin

Content attached to a passage.

Examples:

- Human note
- Faculty annotation
- FacultAI annotation
- Citation
- Image
- Sketch
- Audio note

Margins are first-class content.

### Link

Relationship between passages.

Examples:

- Echoes
- Supports
- Contradicts
- Influenced By
- References
- Expands

Links create the Castalian correspondence graph.

## FacultAI

The most important conceptual revision is that FacultAI is no longer a feature of Scriptorium.

FacultAI is a first-class participant in the Castalia ecosystem: a community of artificial scholars that read Bibliotech, maintain their own commonplace books, annotate texts, review manuscripts, and participate in publication workflows alongside human faculty.

### FacultAI Reading Workflow

When a new book enters Bibliotech:

```text
Import
-> Parse
-> Identify passages
-> Generate embeddings
-> Analyze themes
-> Generate correspondence links
-> Create marginalia
-> Publish FacultAI layer
```

Result:

The book becomes part of the scholarly graph.

### FacultAI Marginalia

FacultAI annotations appear as optional layers.

Reader controls:

- Personal Notes
- Faculty Notes
- Public Notes
- FacultAI Notes

FacultAI never modifies source text. All contributions remain marginalia.

### FacultAI Commonplace Books

Each FacultAI persona maintains one or more commonplace books.

Examples:

- Theology FacultAI
- History FacultAI
- Science FacultAI
- Literature FacultAI

Commonplace entries may include:

- Quotations
- Themes
- Cross-references
- Reading lists

These commonplace books are themselves publishable Codices.

### FacultAI Correspondence Engine

FacultAI continuously proposes relationships.

Example:

```text
Anne Frank
-> echoes
Augustine

Augustine
-> expands
Simone Weil

Simone Weil
-> references
Daniel Commonplace III
```

Links remain suggestions until accepted.

## Peer Review

### FacultAI Review Board

Available reviewers:

- Citation Reviewer
- Argument Reviewer
- Historical Reviewer
- Style Reviewer
- Editorial Reviewer
- Publication Reviewer
- Ethics Reviewer
- Fact Checker

### Review Workflow

```text
Draft Codex
-> FacultAI Review
-> Human Review
-> Revision
-> Approval
-> Publication
```

All reviews become part of the Codex history.

### Review Provenance

Every review includes:

- Reviewer
- Timestamp
- Model Version
- Sources Used
- Decision

Review history is preserved permanently.

## Inquirer Workflow

### Human Authored

```text
Research
-> Draft
-> FacultAI Review
-> Human Edit
-> Publish
```

### FacultAI Authored

```text
Assignment
-> Research
-> Draft
-> FacultAI Peer Review
-> Human Editor
-> Publish
```

### Human + FacultAI Collaboration

```text
Research
-> Draft
-> Shared Editing
-> Peer Review
-> Publication
```

## Commonplace Workflow

```text
Reading
-> Highlight
-> Add to Commonplace
-> Reflection
-> Link
-> Collection
-> Publication
```

A Commonplace is a Codex.

A Codex is a Book.

A Book may generate future Books.

## Publishing Workflow

```text
Private Draft
-> Shared Draft
-> Faculty Review
-> FacultAI Review
-> Published Edition
-> Bibliotech Catalog
```

Every publication receives:

- Version
- Identifier
- Citation Metadata
- Review History
- Provenance

## Long-Term Vision

The Castalia ecosystem becomes a republic of letters composed of:

- Human readers
- Human faculty
- Artificial faculty
- Commonplace books
- Published books
- Articles
- Journals
- Correspondence networks

Books generate marginalia.

Marginalia generates commonplace books.

Commonplace books generate essays.

Essays generate books.

Books return to Bibliotech.

The cycle continues.

## Product Motto

Read deeply.

Write in the margins.

Let books become books.
