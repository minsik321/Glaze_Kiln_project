-- The observation picker and image provider both accept GIF as well as PNG, JPEG and WebP.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id in ('aice-recipe-photos', 'aice-result-photos');
