import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn-style class merge helper (from school-erp-svelte). */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
