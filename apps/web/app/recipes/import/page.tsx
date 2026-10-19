import { ImportFlow } from './import-flow';

export const metadata = { title: 'Import a recipe' };

export default function Page() {
  return (
    <>
      <h1>Import a recipe from photos</h1>
      <p>Photograph or upload up to 6 pages of a recipe card or book page. You will review everything before it is saved.</p>
      <ImportFlow />
    </>
  );
}
