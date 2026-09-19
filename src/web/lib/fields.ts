import type { FieldKey, SourceType } from '../../shared/types';

export type PickMode = FieldKey | 'item';

export interface FieldMeta {
  label: string;
  hint: string;
  /** CSS variable for the app UI. */
  color: string;
  /** Raw colour for the overlay drawn inside the page (CSS variables do not cross the iframe). */
  hex: string;
  defaultAttr: string;
}

export const FIELD_META: Record<PickMode, FieldMeta> = {
  item: { label: 'Élément', hint: 'Le bloc qui se répète pour chaque article', color: 'var(--m-item)', hex: '#1b1e24', defaultAttr: '' },
  title: { label: 'Titre', hint: 'Le titre de l’article', color: 'var(--m-title)', hex: '#ffe14a', defaultAttr: 'text' },
  link: { label: 'Lien', hint: 'L’adresse de l’article', color: 'var(--m-link)', hex: '#8fd0ff', defaultAttr: 'href' },
  description: { label: 'Contenu', hint: 'Le résumé ou le texte', color: 'var(--m-description)', hex: '#cfbbff', defaultAttr: 'html' },
  date: { label: 'Date', hint: 'La date de publication', color: 'var(--m-date)', hex: '#ffa6cc', defaultAttr: '' },
  image: { label: 'Image', hint: 'La vignette', color: 'var(--m-image)', hex: '#9eeaa9', defaultAttr: 'src' },
  author: { label: 'Auteur', hint: 'L’auteur ou la source', color: 'var(--m-author)', hex: '#ffc68d', defaultAttr: 'text' },
};

export const FIELD_ORDER: FieldKey[] = ['title', 'link', 'description', 'date', 'image', 'author'];

export const ATTR_OPTIONS: Record<FieldKey, Array<{ value: string; label: string }>> = {
  title: [
    { value: 'text', label: 'Texte' },
    { value: 'title', label: 'Attribut title' },
    { value: 'alt', label: 'Attribut alt' },
  ],
  link: [
    { value: 'href', label: 'Lien (href)' },
    { value: 'data-href', label: 'data-href' },
    { value: 'text', label: 'Texte' },
  ],
  description: [
    { value: 'html', label: 'HTML' },
    { value: 'text', label: 'Texte' },
  ],
  date: [
    { value: '', label: 'Automatique' },
    { value: 'datetime', label: 'Attribut datetime' },
    { value: 'text', label: 'Texte' },
    { value: 'title', label: 'Attribut title' },
  ],
  image: [
    { value: 'src', label: 'Image (src, lazy…)' },
    { value: 'bg', label: 'Image de fond' },
    { value: 'content', label: 'Attribut content' },
  ],
  author: [
    { value: 'text', label: 'Texte' },
    { value: 'title', label: 'Attribut title' },
  ],
};

export const SOURCE_LABELS: Record<SourceType, string> = {
  html: 'Sélecteurs',
  json: 'API JSON',
  feed: 'Flux existant',
  watch: 'Surveillance',
};

export const REFRESH_CHOICES = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 heure' },
  { value: 180, label: '3 heures' },
  { value: 360, label: '6 heures' },
  { value: 720, label: '12 heures' },
  { value: 1440, label: '1 jour' },
  { value: 10080, label: '1 semaine' },
];
