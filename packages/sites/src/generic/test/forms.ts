/**
 * Synthetic employer pages for the generic definition: standard HTML only, as an employer's own careers page renders
 * it. No live page has been saved yet; these follow the HTML standard's controls, labels and `autocomplete` tokens.
 */

/** A careers page with its application form: each kind of native control, and the ways a prompt is given. */
export const APPLICATION = `
<header><h1>Software Developer</h1></header>
<form id="newsletter" action="/subscribe"><label for="nl">Email</label><input id="nl" type="email" name="nl"><button>Subscribe</button></form>
<form id="apply" action="/careers/apply" method="post">
  <h2>Personal information</h2>
  <label for="fn">First name *</label><input id="fn" name="first_name" autocomplete="given-name" required>
  <label for="ln">Last name</label><input id="ln" name="last_name" autocomplete="family-name" aria-required="true">
  <label>Email <input type="email" name="email"></label>
  <input type="tel" name="phone" placeholder="Phone">
  <span id="li-label">LinkedIn profile</span><input type="url" name="urls[LinkedIn]" aria-labelledby="li-label">
  <input type="hidden" name="source" value="careers">
  <label for="country">Country</label>
  <select id="country" name="country" autocomplete="country-name">
    <option value="">Select…</option><option value="ca">Canada</option><option value="us">United States</option>
  </select>
  <h2>Your application</h2>
  <label for="resume">Resume</label><input id="resume" type="file" name="resume" style="display: none">
  <label for="start">Earliest start date</label><input id="start" type="date" name="start_date">
  <label for="years">Years of experience</label><input id="years" type="number" name="years">
  <label for="why">Why do you want to work here?</label><textarea id="why" name="why"></textarea>
  <fieldset>
    <legend>Are you legally authorized to work in this country? *</legend>
    <label><input type="radio" name="authorized" value="yes" required> Yes</label>
    <label><input type="radio" name="authorized" value="no"> No</label>
  </fieldset>
  <div class="question">
    <p>Which languages do you speak?</p>
    <label><input type="checkbox" name="languages" value="en"> English</label>
    <label><input type="checkbox" name="languages" value="fr"> French</label>
  </div>
  <label><input type="checkbox" name="consent"> I agree to the privacy policy</label>
  <input name="unlabelled">
  <div role="combobox" aria-label="Location" tabindex="0"></div>
  <button type="submit">Submit application</button>
</form>`;

/** A sign-in form: an email and a password, which never counts as an application. */
export const SIGN_IN = `
<h1>Sign in</h1>
<form><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="pw"></label>
<label>First name <input name="first"></label><label>Last name <input name="last"></label><label>Phone <input name="phone"></label>
<button type="submit">Sign in</button></form>`;

/** A search form and a newsletter form: no application. */
export const NO_APPLICATION = `
<h1>Careers</h1>
<form role="search"><label>Keywords <input type="search" name="q"></label><button>Search</button></form>
<form><label>Email <input type="email" name="email"></label><button>Subscribe</button></form>`;

/** The page after a real Submit. */
export const CONFIRMATION = "<h1>Software Developer</h1><p>Thank you for applying! We'll be in touch.</p>";

/** An application whose send button is a plain `<button>` reading "Apply now", and whose choices sit in the form. */
export const APPLY_BUTTON = `
<h1>Data Analyst</h1>
<form><label>Full name <input name="name"></label><label>Email <input type="email" name="email"></label>
<label>Cover letter <input type="file" name="cover"></label>
<label><input type="radio" name="remote" value="y"> Remote</label><label><input type="radio" name="remote" value="n"> On site</label>
<button type="button">Apply now</button></form>`;
